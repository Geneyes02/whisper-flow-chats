
-- Revoke public/anon execute on security-definer helpers.
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.is_staff(uuid) from public, anon;
revoke execute on function public.is_conversation_member(uuid, uuid) from public, anon;
revoke execute on function public.is_community_member(uuid, uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tg_set_updated_at() from public, anon, authenticated;

-- Ensure authenticated can still invoke the RLS helpers.
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_staff(uuid) to authenticated;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;
grant execute on function public.is_community_member(uuid, uuid) to authenticated;

-- Tighten the community update policy WITH CHECK.
drop policy if exists "Community owner (creator) can update" on public.communities;
create policy "Community owner can update"
  on public.communities for update to authenticated
  using (
    exists (
      select 1 from public.community_members cm
      where cm.community_id = id and cm.user_id = auth.uid()
        and cm.is_owner and cm.left_at is null and cm.banned_at is null
    )
  )
  with check (
    exists (
      select 1 from public.community_members cm
      where cm.community_id = id and cm.user_id = auth.uid()
        and cm.is_owner and cm.left_at is null and cm.banned_at is null
    )
  );
