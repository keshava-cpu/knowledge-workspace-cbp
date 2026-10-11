create or replace function public.get_document_bucket_usage_bytes()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  total_bytes bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to read storage usage';
  end if;

  select coalesce(sum((files.metadata ->> 'size')::bigint), 0)::bigint
    into total_bytes
    from storage.objects as files
   where files.bucket_id = 'knowledge-workspace-documents'
     and files.metadata ->> 'size' ~ '^[0-9]+$';

  return total_bytes;
end;
$$;

revoke all on function public.get_document_bucket_usage_bytes() from public, anon, authenticated;
grant execute on function public.get_document_bucket_usage_bytes() to authenticated;