drop function if exists public.search_document_chunks(
  text, extensions.vector, text, uuid, integer, integer
);

create function public.search_document_chunks(
  p_query_text text,
  p_query_embedding extensions.vector(384),
  p_embedding_model text,
  p_document_id uuid default null,
  p_result_limit integer default 10,
  p_candidate_limit integer default 80
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  filename text,
  excerpt text,
  page_numbers integer[],
  location_metadata jsonb,
  score double precision,
  semantic_similarity double precision,
  semantic_rank bigint,
  lexical_rank bigint,
  retrieval_methods text[]
)
language sql
stable
security definer
set search_path = ''
set hnsw.ef_search = 100
set hnsw.iterative_scan = strict_order
as $$
  with scoped_chunks as not materialized (
    select
      chunks.id,
      chunks.document_id,
      chunks.content,
      chunks.page_numbers,
      chunks.location_metadata,
      chunks.embedding,
      chunks.search_vector,
      documents.title,
      documents.filename
    from public.document_chunks as chunks
    join public.documents as documents
      on documents.id = chunks.document_id
     and documents.owner_id = chunks.owner_id
    where chunks.owner_id = (select auth.uid())
      and chunks.embedding_model = p_embedding_model
      and documents.indexing_status = 'completed'
      and (p_document_id is null or chunks.document_id = p_document_id)
  ),
  semantic_ann as materialized (
    select chunks.id,
           chunks.embedding OPERATOR(extensions.<=>) p_query_embedding as distance
    from public.document_chunks as chunks
    where chunks.owner_id = (select auth.uid())
      and chunks.embedding_model = p_embedding_model
      and (p_document_id is null or chunks.document_id = p_document_id)
    order by chunks.embedding OPERATOR(extensions.<=>) p_query_embedding
    limit least(greatest(p_candidate_limit, 10), 100)
  ),
  semantic_backfill as materialized (
    select chunks.id, chunks.embedding
    from public.document_chunks as chunks
    where chunks.owner_id = (select auth.uid())
      and chunks.embedding_model = p_embedding_model
      and (p_document_id is null or chunks.document_id = p_document_id)
      and (select count(*) from semantic_ann)
        < least(greatest(p_candidate_limit, 10), 100)
      and not exists (
        select 1 from semantic_ann where semantic_ann.id = chunks.id
      )
  ),
  semantic_fallback as (
    select semantic_backfill.id,
           semantic_backfill.embedding OPERATOR(extensions.<=>) p_query_embedding as distance
    from semantic_backfill
    order by semantic_backfill.embedding OPERATOR(extensions.<=>) p_query_embedding
    limit greatest(
      least(greatest(p_candidate_limit, 10), 100)
        - (select count(*) from semantic_ann),
      0
    )
  ),
  semantic_candidates as (
    select candidates.id,
           row_number() over (order by candidates.distance) as rank,
           1.0 - candidates.distance as semantic_similarity
    from (
      select semantic_ann.id, semantic_ann.distance from semantic_ann
      union all
      select semantic_fallback.id, semantic_fallback.distance from semantic_fallback
    ) as candidates
  ),
  exact_candidates as (
    select chunks.id,
           row_number() over (
             order by ts_rank_cd(
               chunks.search_vector,
               phraseto_tsquery('english', p_query_text)
             ) desc
           ) as rank
    from public.document_chunks as chunks
    where chunks.owner_id = (select auth.uid())
      and chunks.embedding_model = p_embedding_model
      and (p_document_id is null or chunks.document_id = p_document_id)
      and chunks.search_vector @@ phraseto_tsquery('english', p_query_text)
    order by ts_rank_cd(
      chunks.search_vector,
      phraseto_tsquery('english', p_query_text)
    ) desc
    limit least(greatest(p_candidate_limit, 10), 100)
  ),
  lexical_candidates as (
    select chunks.id,
           row_number() over (
             order by ts_rank_cd(
               chunks.search_vector,
               websearch_to_tsquery('english', p_query_text)
             ) desc
           ) as rank
    from public.document_chunks as chunks
    where chunks.owner_id = (select auth.uid())
      and chunks.embedding_model = p_embedding_model
      and (p_document_id is null or chunks.document_id = p_document_id)
      and chunks.search_vector @@ websearch_to_tsquery('english', p_query_text)
      and not (chunks.search_vector @@ phraseto_tsquery('english', p_query_text))
    order by ts_rank_cd(
      chunks.search_vector,
      websearch_to_tsquery('english', p_query_text)
    ) desc
    limit least(greatest(p_candidate_limit, 10), 100)
  ),
  fused_ranks as (
    select semantic_candidates.id,
           semantic_candidates.rank as semantic_rank,
           null::bigint as lexical_rank,
           semantic_candidates.semantic_similarity,
           1.0 / (60 + semantic_candidates.rank)::double precision as contribution,
           'semantic'::text as method
    from semantic_candidates
    union all
    select exact_candidates.id,
           null::bigint,
           exact_candidates.rank,
           null::double precision,
           1.0 / (60 + exact_candidates.rank)::double precision,
           'exact'::text
    from exact_candidates
    union all
    select lexical_candidates.id,
           null::bigint,
           lexical_candidates.rank,
           null::double precision,
           1.0 / (60 + lexical_candidates.rank)::double precision,
           'fulltext'::text
    from lexical_candidates
  ),
  fused as (
    select fused_ranks.id,
           max(fused_ranks.semantic_rank) as semantic_rank,
           min(fused_ranks.lexical_rank) as lexical_rank,
           max(fused_ranks.semantic_similarity) as semantic_similarity,
           sum(fused_ranks.contribution) as score,
           array_agg(distinct fused_ranks.method) as retrieval_methods
    from fused_ranks
    group by fused_ranks.id
  )
  select fused.id,
         scoped_chunks.document_id,
         scoped_chunks.title,
         scoped_chunks.filename,
         scoped_chunks.content,
         scoped_chunks.page_numbers,
         scoped_chunks.location_metadata,
         fused.score,
         fused.semantic_similarity,
         fused.semantic_rank,
         fused.lexical_rank,
         fused.retrieval_methods
  from fused
  join scoped_chunks on scoped_chunks.id = fused.id
  order by fused.score desc, scoped_chunks.document_id, fused.id
  limit least(
    greatest(p_result_limit, 1),
    least(greatest(p_candidate_limit, 10), 100)
  );
$$;

revoke all on function public.search_document_chunks(
  text, extensions.vector, text, uuid, integer, integer
) from public, anon;
grant execute on function public.search_document_chunks(
  text, extensions.vector, text, uuid, integer, integer
) to authenticated;

comment on function public.search_document_chunks(
  text, extensions.vector, text, uuid, integer, integer
) is
  'Authenticated-only indexed search. SECURITY DEFINER avoids the RLS planner barrier; every candidate is scoped to auth.uid(), there is no caller-supplied owner ID, the search path is empty, table RLS remains enabled, and semantic_similarity is raw cosine similarity rather than a confidence score.';