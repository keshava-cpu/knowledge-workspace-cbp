create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  filename text not null check (length(btrim(filename)) > 0),
  title text not null check (length(btrim(title)) > 0),
  content_type text not null default 'application/pdf'
    check (content_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes > 0),
  storage_path text not null,
  page_count integer check (page_count is null or page_count > 0),
  created_at timestamptz not null default now(),
  constraint documents_owner_storage_path_unique unique (owner_id, storage_path),
  constraint documents_id_owner_unique unique (id, owner_id),
  constraint documents_storage_path_owner_prefix check (
    split_part(storage_path, '/', 1) = owner_id::text
  )
);

create index if not exists documents_owner_created_at_idx
  on public.documents (owner_id, created_at desc);

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique,
  owner_id uuid not null references auth.users (id) on delete cascade,
  docling_task_id text unique,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processing_jobs_document_owner_fk
    foreign key (document_id, owner_id)
    references public.documents (id, owner_id)
    on delete cascade,
  constraint processing_jobs_id_document_owner_unique
    unique (id, document_id, owner_id)
);

create index if not exists processing_jobs_owner_status_created_idx
  on public.processing_jobs (owner_id, status, created_at desc);

create table if not exists public.document_extractions (
  document_id uuid primary key,
  job_id uuid not null unique,
  owner_id uuid not null references auth.users (id) on delete cascade,
  markdown text not null default '',
  structured_content jsonb,
  blocks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(blocks) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_extractions_document_owner_fk
    foreign key (document_id, owner_id)
    references public.documents (id, owner_id)
    on delete cascade,
  constraint document_extractions_job_document_owner_fk
    foreign key (job_id, document_id, owner_id)
    references public.processing_jobs (id, document_id, owner_id)
    on delete cascade
);

create index if not exists document_extractions_owner_updated_idx
  on public.document_extractions (owner_id, updated_at desc);

alter table public.documents enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.document_extractions enable row level security;

create policy "documents_select_own"
  on public.documents for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "documents_insert_own"
  on public.documents for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "documents_update_own"
  on public.documents for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "documents_delete_own"
  on public.documents for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "processing_jobs_select_own"
  on public.processing_jobs for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "processing_jobs_insert_own"
  on public.processing_jobs for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "processing_jobs_update_own"
  on public.processing_jobs for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "processing_jobs_delete_own"
  on public.processing_jobs for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "document_extractions_select_own"
  on public.document_extractions for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "document_extractions_insert_own"
  on public.document_extractions for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "document_extractions_update_own"
  on public.document_extractions for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "document_extractions_delete_own"
  on public.document_extractions for delete to authenticated
  using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'knowledge-workspace-documents',
  'knowledge-workspace-documents',
  false,
  52428800,
  array['application/pdf']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "knowledge_documents_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'knowledge-workspace-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "knowledge_documents_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'knowledge-workspace-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "knowledge_documents_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'knowledge-workspace-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'knowledge-workspace-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "knowledge_documents_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'knowledge-workspace-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
