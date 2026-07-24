
-- 1. FORWARDING
alter table public.messages
  add column if not exists forwarded_from_message_id uuid references public.messages(id) on delete set null,
  add column if not exists forwarded_from_conversation_id uuid references public.conversations(id) on delete set null;

-- 2. WEB PUSH SUBSCRIPTIONS
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subs" on public.push_subscriptions;
create policy "own push subs" on public.push_subscriptions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. CONVERSATION INVITES
create table if not exists public.conversation_invites (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  max_uses integer,
  uses integer not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists conv_invites_conv_idx on public.conversation_invites(conversation_id);
grant select, insert, update on public.conversation_invites to authenticated;
grant all on public.conversation_invites to service_role;
alter table public.conversation_invites enable row level security;

drop policy if exists "invite lookup by code" on public.conversation_invites;
create policy "invite lookup by code" on public.conversation_invites
  for select to authenticated using (true);

drop policy if exists "members create invites" on public.conversation_invites;
create policy "members create invites" on public.conversation_invites
  for insert to authenticated
  with check (public.is_conversation_member(auth.uid(), conversation_id));

drop policy if exists "members update invites" on public.conversation_invites;
create policy "members update invites" on public.conversation_invites
  for update to authenticated
  using (public.is_conversation_member(auth.uid(), conversation_id));

-- 4. STORAGE RLS on storage.objects (bucket already created)
drop policy if exists "chat media read" on storage.objects;
create policy "chat media read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and public.is_conversation_member(auth.uid(), (split_part(name, '/', 1))::uuid)
  );

drop policy if exists "chat media insert" on storage.objects;
create policy "chat media insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and public.is_conversation_member(auth.uid(), (split_part(name, '/', 1))::uuid)
  );

drop policy if exists "chat media delete own" on storage.objects;
create policy "chat media delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and owner = auth.uid()
  );

-- 5. REALTIME PUBLICATION
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.messages'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.message_reactions'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.message_receipts'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.conversation_members'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.conversations'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.message_attachments'; exception when others then null; end;
end $$;

alter table public.messages replica identity full;
alter table public.message_reactions replica identity full;
alter table public.message_receipts replica identity full;
alter table public.conversation_members replica identity full;
alter table public.message_attachments replica identity full;
