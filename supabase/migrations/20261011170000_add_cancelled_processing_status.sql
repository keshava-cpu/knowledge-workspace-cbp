alter table public.processing_jobs
  drop constraint if exists processing_jobs_status_check;

alter table public.processing_jobs
  add constraint processing_jobs_status_check
  check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled'));