create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated;

alter table public.documents
  add column if not exists indexing_status text not null default 'pending'
    check (indexing_status in ('pending', 'processing', 'completed', 'failed')),
  add column if not exists indexed_chunks integer not null default 0
    check (indexed_chunks >= 0),
  add column if not exists indexing_error text,
  add column if not exists indexed_at timestamptz;

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  owner_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (length(btrim(content)) > 0),
  page_numbers integer[] not null default '{}',
  location_metadata jsonb not null default '[]'::jsonb
    check (jsonb_typeof(location_metadata) = 'array'),
  embedding_model text not null,
  embedding extensions.vector(384) not null,
  search_vector tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  constraint document_chunks_unique_index unique (document_id, chunk_index),
  constraint document_chunks_document_owner_fk
    foreign key (document_id, owner_id)
    references public.documents (id, owner_id)
    on delete cascade
);

create index if not exists document_chunks_owner_document_idx
  on public.document_chunks (owner_id, document_id, chunk_index);

create index if not exists document_chunks_search_vector_gin_idx
  on public.document_chunks using gin (search_vector);

create index if not exists document_chunks_embedding_hnsw_idx
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table public.document_chunks enable row level security;

create policy "document_chunks_select_own"
  on public.document_chunks for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "document_chunks_insert_own"
  on public.document_chunks for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "document_chunks_update_own"
  on public.document_chunks for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "document_chunks_delete_own"
  on public.document_chunks for delete to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.search_document_chunks(
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
  -- RLS stays enabled for direct access. This RPC has no owner argument; every candidate and result is scoped to auth.uid().
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
           row_number() over (order by candidates.distance) as rank
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
           1.0 / (60 + semantic_candidates.rank)::double precision as contribution,
           'semantic'::text as method
    from semantic_candidates
    union all
    select exact_candidates.id,
           null::bigint,
           exact_candidates.rank,
           1.0 / (60 + exact_candidates.rank)::double precision,
           'exact'::text
    from exact_candidates
    union all
    select lexical_candidates.id,
           null::bigint,
           lexical_candidates.rank,
           1.0 / (60 + lexical_candidates.rank)::double precision,
           'fulltext'::text
    from lexical_candidates
  ),
  fused as (
    select fused_ranks.id,
           max(fused_ranks.semantic_rank) as semantic_rank,
           min(fused_ranks.lexical_rank) as lexical_rank,
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
         fused.semantic_rank,
         fused.lexical_rank,
         fused.retrieval_methods
  from fused
  join scoped_chunks on scoped_chunks.id = fused.id
  order by fused.score desc, scoped_chunks.document_id, fused.id
  limit least(greatest(p_result_limit, 1), 20);
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
  'Authenticated-only indexed search. SECURITY DEFINER avoids the RLS planner barrier; every candidate is scoped to auth.uid(), there is no caller-supplied owner ID, the search path is empty, and table RLS remains enabled.';