create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required to delete an account';
  end if;

  if exists (
    select 1
      from storage.objects as files
     where files.bucket_id = 'knowledge-workspace-documents'
       and (storage.foldername(files.name))[1] = current_user_id::text
  ) then
    raise exception 'Remove account files through Storage before deleting the account';
  end if;

  delete from auth.users where id = current_user_id;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;