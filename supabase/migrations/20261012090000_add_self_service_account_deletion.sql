create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth, storage, extensions
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required to delete an account';
  end if;

  delete from storage.objects
  where bucket_id = 'knowledge-workspace-documents'
    and (
      owner_id = current_user_id
      or name like current_user_id::text || '/%'
    );

  delete from auth.users where id = current_user_id;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;