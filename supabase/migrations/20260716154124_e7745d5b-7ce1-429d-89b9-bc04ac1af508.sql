
-- =============================================================================
-- WHISPR — Backend foundation
-- Privacy-first messaging, calls, and communities.
-- =============================================================================

-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- =============================================================================
-- ENUMS
-- =============================================================================

create type public.app_role as enum ('user', 'support', 'moderator', 'admin');

create type public.account_status as enum ('active', 'suspended', 'deactivated', 'deleted');

create type public.device_platform as enum ('ios', 'android', 'macos', 'windows', 'linux', 'web');
create type public.device_status as enum ('pending', 'active', 'inactive', 'revoked');

create type public.conversation_type as enum ('direct', 'group', 'channel');
create type public.conversation_member_role as enum ('owner', 'admin', 'moderator', 'member');

create type public.message_content_type as enum (
  'text', 'image', 'video', 'audio', 'voice', 'file', 'contact', 'location', 'sticker', 'gif', 'poll', 'system'
);
create type public.message_status as enum ('pending', 'sent', 'delivered', 'failed', 'edited', 'deleted');
create type public.delivery_state as enum ('pending', 'delivered', 'read', 'failed');

create type public.community_visibility as enum ('public', 'private', 'invite_only');
create type public.channel_kind as enum ('text', 'voice', 'announcement');

create type public.report_target as enum ('user', 'message', 'conversation', 'community', 'channel');
create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');

-- =============================================================================
-- UTILITY: updated_at trigger
-- =============================================================================

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- PROFILES  (public, safe to expose to other authenticated users)
-- =============================================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext unique,                          -- canonical handle
  display_name text,
  avatar_url text,
  banner_url text,
  bio text,
  status_text text,                                -- e.g. "on vacation"
  status_emoji text,
  is_verified boolean not null default false,
  is_bot boolean not null default false,
  discoverable boolean not null default true,     -- appears in username search
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.profiles is
  'Public profile data other users may see. Never store sensitive account details here.';

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

-- =============================================================================
-- USERNAME RESERVATIONS  (audit trail of username changes; profiles.username is canonical)
-- =============================================================================
create table public.usernames (
  username citext primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reserved_at timestamptz not null default now(),
  released_at timestamptz
);
comment on table public.usernames is
  'Historical reservation ledger. profiles.username is the currently active handle.';

grant select on public.usernames to authenticated;
grant all on public.usernames to service_role;

alter table public.usernames enable row level security;

-- =============================================================================
-- ACCOUNT PRIVATE  (owner + support only)
-- =============================================================================
create table public.account_private (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status public.account_status not null default 'active',
  recovery_email citext,
  phone_number text,
  locale text default 'en',
  timezone text,
  marketing_opt_in boolean not null default false,
  onboarding_completed_at timestamptz,
  privacy_preferences jsonb not null default '{}'::jsonb,
  notification_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.account_private is
  'Sensitive per-account settings. Never exposed to other users; readable by owner and support staff only.';

grant select, insert, update on public.account_private to authenticated;
grant all on public.account_private to service_role;

alter table public.account_private enable row level security;

-- =============================================================================
-- ROLES
-- =============================================================================
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  unique (user_id, role)
);
comment on table public.user_roles is
  'Role assignments. Kept separate from profiles/account_private so users cannot self-elevate.';

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

-- has_role: security definer to avoid recursive RLS during policy checks
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role in ('admin','moderator','support')
  );
$$;

-- =============================================================================
-- DEVICES  (multi-device from day one; carries protocol-agnostic keys)
-- =============================================================================
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,                              -- "Ella's iPhone"
  platform public.device_platform not null,
  status public.device_status not null default 'pending',

  -- Protocol-agnostic identity material.
  -- These fields hold the *public* portion of whatever E2EE protocol
  -- is integrated later (Signal Protocol X3DH, MLS, etc.).
  -- Private key material never leaves the device.
  public_identity_key bytea,                       -- long-lived identity key
  public_signed_prekey bytea,                      -- signed pre-key
  signed_prekey_signature bytea,
  key_algorithm text,                              -- e.g. 'curve25519', 'x25519+ed25519', 'mls-1'
  key_version int not null default 1,

  fingerprint text,                                -- human-readable safety number
  last_active_at timestamptz,
  registered_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.devices is
  'Per-user devices with protocol-agnostic public key slots for future end-to-end encryption.';

create index devices_user_id_idx on public.devices(user_id);

grant select, insert, update on public.devices to authenticated;
grant all on public.devices to service_role;

alter table public.devices enable row level security;

-- =============================================================================
-- SESSIONS  (active auth sessions tied to a device)
-- =============================================================================
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  ip_hash text,                                    -- hash, never raw IP
  user_agent text,
  location_hint text,                              -- coarse city/region
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.sessions is
  'Active app sessions. Users manage these from the Privacy Center to revoke device access.';

create index sessions_user_id_idx on public.sessions(user_id);
create index sessions_device_id_idx on public.sessions(device_id);

grant select, insert, update on public.sessions to authenticated;
grant all on public.sessions to service_role;

alter table public.sessions enable row level security;

-- =============================================================================
-- CONTACTS  (owner-scoped address book)
-- =============================================================================
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_user_id uuid not null references auth.users(id) on delete cascade,
  nickname text,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, contact_user_id),
  check (owner_id <> contact_user_id)
);
comment on table public.contacts is
  'Per-user address book. Rows are owner-private.';

grant select, insert, update, delete on public.contacts to authenticated;
grant all on public.contacts to service_role;

alter table public.contacts enable row level security;

-- =============================================================================
-- BLOCKS
-- =============================================================================
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
comment on table public.blocks is 'Per-user block list. Owner-private.';

grant select, insert, delete on public.blocks to authenticated;
grant all on public.blocks to service_role;

alter table public.blocks enable row level security;

-- =============================================================================
-- CONVERSATIONS
-- =============================================================================
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type public.conversation_type not null,
  title text,                                      -- group / channel name (null for 1:1)
  avatar_url text,
  created_by uuid references auth.users(id) on delete set null,

  -- disappearing messages: null = disabled
  disappearing_seconds integer,

  -- reference back to a community channel (nullable — most conversations aren't channels)
  community_id uuid,                               -- FK added later after communities exist

  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (disappearing_seconds is null or disappearing_seconds > 0)
);
comment on table public.conversations is
  'A message container: direct, group, or a community channel. Content lives in messages / message_envelopes.';

create index conversations_last_message_idx on public.conversations(last_message_at desc nulls last);

grant select, insert, update on public.conversations to authenticated;
grant all on public.conversations to service_role;

alter table public.conversations enable row level security;

-- =============================================================================
-- CONVERSATION MEMBERS
-- =============================================================================
create table public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.conversation_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  muted_until timestamptz,
  last_read_message_id uuid,                       -- FK added after messages exists (soft ref)
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  is_favorite boolean not null default false,
  notification_level text not null default 'all', -- 'all' | 'mentions' | 'none'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);
comment on table public.conversation_members is
  'Which users belong to which conversations, plus per-user state (pin, archive, mute, last read).';

create index cm_user_id_idx on public.conversation_members(user_id) where left_at is null;
create index cm_conv_id_idx on public.conversation_members(conversation_id) where left_at is null;

grant select, insert, update on public.conversation_members to authenticated;
grant all on public.conversation_members to service_role;

alter table public.conversation_members enable row level security;

-- Security definer helper: is this user a live member of this conversation?
create or replace function public.is_conversation_member(_user_id uuid, _conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = _conversation_id
      and user_id = _user_id
      and left_at is null
  );
$$;

-- =============================================================================
-- MESSAGES  (envelope metadata; body is stored as opaque ciphertext)
-- =============================================================================
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_device_id uuid references public.devices(id) on delete set null,
  reply_to_message_id uuid references public.messages(id) on delete set null,
  thread_root_id uuid references public.messages(id) on delete set null,

  content_type public.message_content_type not null default 'text',
  status public.message_status not null default 'sent',

  -- Encrypted payload. Never plaintext.
  -- For simple 1:1 the envelope may live here directly; for group/E2EE the actual
  -- ciphertext per recipient lives in message_envelopes and this may be null.
  ciphertext bytea,
  ciphertext_nonce bytea,
  ciphertext_algorithm text,                       -- e.g. 'aes-256-gcm', 'signal-1', 'mls-1'
  ciphertext_version int not null default 1,

  -- Non-sensitive routing metadata (safe to see the *existence* of, not the content)
  has_attachments boolean not null default false,
  mention_user_ids uuid[] not null default '{}',   -- for @mention notification fan-out
  is_pinned boolean not null default false,

  scheduled_for timestamptz,
  expires_at timestamptz,                          -- disappearing messages
  edited_at timestamptz,
  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.messages is
  'Message envelope. Body is opaque ciphertext — servers route it, they do not read it.';

create index messages_conv_idx on public.messages(conversation_id, created_at desc);
create index messages_sender_idx on public.messages(sender_id);
create index messages_scheduled_idx on public.messages(scheduled_for) where scheduled_for is not null and status = 'pending';

grant select, insert, update on public.messages to authenticated;
grant all on public.messages to service_role;

alter table public.messages enable row level security;

-- =============================================================================
-- MESSAGE ENVELOPES  (per-recipient-device ciphertext; the E2EE fan-out shape)
-- =============================================================================
create table public.message_envelopes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_device_id uuid not null references public.devices(id) on delete cascade,
  ciphertext bytea not null,
  ciphertext_nonce bytea,
  ciphertext_algorithm text,
  ciphertext_version int not null default 1,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, recipient_device_id)
);
comment on table public.message_envelopes is
  'Per-recipient-device encrypted copies. Enables Signal-style fan-out without server-side decryption.';

create index me_recipient_idx on public.message_envelopes(recipient_user_id, delivered_at);

grant select, insert, update on public.message_envelopes to authenticated;
grant all on public.message_envelopes to service_role;

alter table public.message_envelopes enable row level security;

-- =============================================================================
-- MESSAGE ATTACHMENTS
-- =============================================================================
create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  storage_bucket text not null default 'whispr-media',
  storage_path text not null,
  size_bytes bigint,
  mime_hint text,                                  -- coarse hint; real MIME is encrypted metadata
  encrypted_metadata bytea,                        -- filename, exact mime, checksum, thumbnail info
  encrypted_metadata_nonce bytea,
  encryption_algorithm text,
  encryption_key_ref text,                         -- reference to per-message content key; NEVER the key itself
  duration_seconds int,                            -- audio/video length (safe metadata)
  width int,
  height int,
  created_at timestamptz not null default now()
);
comment on table public.message_attachments is
  'File attachment records. Content bytes live in Storage encrypted client-side; only opaque metadata is here.';

create index ma_message_idx on public.message_attachments(message_id);

grant select, insert, update, delete on public.message_attachments to authenticated;
grant all on public.message_attachments to service_role;

alter table public.message_attachments enable row level security;

-- =============================================================================
-- MESSAGE REACTIONS
-- =============================================================================
create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
comment on table public.message_reactions is
  'Emoji reactions on messages. Visible to all conversation members.';

grant select, insert, delete on public.message_reactions to authenticated;
grant all on public.message_reactions to service_role;

alter table public.message_reactions enable row level security;

-- =============================================================================
-- MESSAGE RECEIPTS  (per-user delivery/read status)
-- =============================================================================
create table public.message_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state public.delivery_state not null default 'pending',
  delivered_at timestamptz,
  read_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);
comment on table public.message_receipts is
  'Per-user delivery and read receipts. Users may hide theirs via privacy_preferences.';

create index mr_user_idx on public.message_receipts(user_id, updated_at desc);

grant select, insert, update on public.message_receipts to authenticated;
grant all on public.message_receipts to service_role;

alter table public.message_receipts enable row level security;

-- =============================================================================
-- COMMUNITIES
-- =============================================================================
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug citext unique,
  name text not null,
  description text,
  avatar_url text,
  banner_url text,
  visibility public.community_visibility not null default 'private',
  created_by uuid references auth.users(id) on delete set null,
  member_count int not null default 0,             -- denormalized; maintained by app or triggers
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.communities is
  'A community (server / space). Contains channels, roles, and members.';

grant select, insert, update on public.communities to authenticated;
grant all on public.communities to service_role;
grant select on public.communities to anon; -- for discovery of public communities via policy below

alter table public.communities enable row level security;

-- Add the deferred FK from conversations.community_id
alter table public.conversations
  add constraint conversations_community_id_fkey
  foreign key (community_id) references public.communities(id) on delete cascade;

-- =============================================================================
-- COMMUNITY ROLES  (per-community role definitions)
-- =============================================================================
create table public.community_roles (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null,
  color text,
  position int not null default 0,
  permissions jsonb not null default '{}'::jsonb,  -- e.g. { "post": true, "kick": false }
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, name)
);
comment on table public.community_roles is
  'Role definitions inside a community. Permissions are a JSON bag for flexibility.';

grant select on public.community_roles to authenticated;
grant all on public.community_roles to service_role;

alter table public.community_roles enable row level security;

-- =============================================================================
-- COMMUNITY MEMBERS
-- =============================================================================
create table public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_owner boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  banned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, user_id)
);
comment on table public.community_members is
  'Membership in a community with lifecycle (joined / left / banned).';

create index community_members_user_idx on public.community_members(user_id) where left_at is null and banned_at is null;

grant select, insert, update on public.community_members to authenticated;
grant all on public.community_members to service_role;

alter table public.community_members enable row level security;

-- Security definer helper: is this user an active community member?
create or replace function public.is_community_member(_user_id uuid, _community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.community_members
    where community_id = _community_id
      and user_id = _user_id
      and left_at is null
      and banned_at is null
  );
$$;

-- =============================================================================
-- COMMUNITY ROLE ASSIGNMENTS  (many-to-many between members and roles)
-- =============================================================================
create table public.community_role_assignments (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.community_roles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (community_id, user_id, role_id)
);

grant select on public.community_role_assignments to authenticated;
grant all on public.community_role_assignments to service_role;

alter table public.community_role_assignments enable row level security;

-- =============================================================================
-- CHANNELS  (backed by a conversation of type 'channel')
-- =============================================================================
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  name text not null,
  slug citext not null,
  kind public.channel_kind not null default 'text',
  description text,
  position int not null default 0,
  is_private boolean not null default false,       -- restricted to specific roles
  allowed_role_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (community_id, slug)
);
comment on table public.channels is
  'A channel inside a community. Its messages live in the linked conversation.';

grant select, insert, update on public.channels to authenticated;
grant all on public.channels to service_role;

alter table public.channels enable row level security;

-- =============================================================================
-- REPORTS  (abuse / trust-and-safety)
-- =============================================================================
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type public.report_target not null,
  target_id uuid not null,
  reason text not null,
  details text,
  status public.report_status not null default 'open',
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.reports is
  'User-submitted reports. Readable only by the reporter and staff.';

grant select, insert on public.reports to authenticated;
grant all on public.reports to service_role;

alter table public.reports enable row level security;

-- =============================================================================
-- AUDIT LOGS  (admin-visible immutable trail)
-- =============================================================================
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,                            -- e.g. 'role.granted', 'community.deleted'
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);
comment on table public.audit_logs is
  'Append-only audit trail. Never mutated; only staff can read.';

grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;

alter table public.audit_logs enable row level security;

-- =============================================================================
-- TRIGGERS: updated_at
-- =============================================================================
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'profiles','account_private','devices','sessions','contacts',
      'conversations','conversation_members','messages','message_receipts',
      'communities','community_roles','community_members','channels','reports'
    ])
  loop
    execute format(
      'create trigger tg_%1$s_updated_at before update on public.%1$s
       for each row execute function public.tg_set_updated_at();', t
    );
  end loop;
end$$;

-- =============================================================================
-- TRIGGER: auto-create profile + private + default role on new auth user
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.account_private (user_id, recovery_email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- POLICIES: PROFILES
-- =============================================================================
create policy "Profiles are readable by any authenticated user"
  on public.profiles for select to authenticated
  using (deleted_at is null);

create policy "Users can insert their own profile row"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "Staff can update any profile"
  on public.profiles for update to authenticated
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- =============================================================================
-- POLICIES: USERNAMES
-- =============================================================================
create policy "Anyone signed in can look up username reservations"
  on public.usernames for select to authenticated using (true);

-- Inserts/deletes go through server functions (service_role).

-- =============================================================================
-- POLICIES: ACCOUNT PRIVATE
-- =============================================================================
create policy "Owner can read their private account"
  on public.account_private for select to authenticated
  using (auth.uid() = user_id);

create policy "Owner can insert their private account row"
  on public.account_private for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Owner can update their private account"
  on public.account_private for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Support staff can read any private account"
  on public.account_private for select to authenticated
  using (public.is_staff(auth.uid()));

-- =============================================================================
-- POLICIES: USER ROLES
-- =============================================================================
create policy "Users can read their own roles"
  on public.user_roles for select to authenticated
  using (auth.uid() = user_id);

create policy "Admins can read all roles"
  on public.user_roles for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Role mutations happen server-side via service_role only (never client).

-- =============================================================================
-- POLICIES: DEVICES
-- =============================================================================
create policy "Users read their own devices"
  on public.devices for select to authenticated
  using (auth.uid() = user_id);

create policy "Users register their own devices"
  on public.devices for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users update their own devices"
  on public.devices for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Conversation members may read *public key material* of other members' devices
-- to encrypt messages to them. This is essential for E2EE fan-out and is
-- exposed only via a security-definer service function (getPrekeyBundle) —
-- direct SELECT stays owner-only.

-- =============================================================================
-- POLICIES: SESSIONS
-- =============================================================================
create policy "Users read their own sessions"
  on public.sessions for select to authenticated
  using (auth.uid() = user_id);

create policy "Users update (revoke) their own sessions"
  on public.sessions for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Session inserts happen server-side.

-- =============================================================================
-- POLICIES: CONTACTS
-- =============================================================================
create policy "Owner reads their contacts"
  on public.contacts for select to authenticated
  using (auth.uid() = owner_id);

create policy "Owner manages their contacts"
  on public.contacts for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "Owner updates their contacts"
  on public.contacts for update to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Owner deletes their contacts"
  on public.contacts for delete to authenticated
  using (auth.uid() = owner_id);

-- =============================================================================
-- POLICIES: BLOCKS
-- =============================================================================
create policy "Owner reads their blocks"
  on public.blocks for select to authenticated
  using (auth.uid() = blocker_id);

create policy "Owner creates blocks"
  on public.blocks for insert to authenticated
  with check (auth.uid() = blocker_id);

create policy "Owner removes blocks"
  on public.blocks for delete to authenticated
  using (auth.uid() = blocker_id);

-- =============================================================================
-- POLICIES: CONVERSATIONS
-- =============================================================================
create policy "Members can read their conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(auth.uid(), id));

create policy "Authenticated users can create conversations"
  on public.conversations for insert to authenticated
  with check (auth.uid() = created_by);

create policy "Conversation members can update conversation metadata"
  on public.conversations for update to authenticated
  using (public.is_conversation_member(auth.uid(), id))
  with check (public.is_conversation_member(auth.uid(), id));

-- =============================================================================
-- POLICIES: CONVERSATION MEMBERS
-- =============================================================================
create policy "Members can read membership of their conversations"
  on public.conversation_members for select to authenticated
  using (public.is_conversation_member(auth.uid(), conversation_id));

create policy "Users can insert themselves as member (invite flows use server-side)"
  on public.conversation_members for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own membership state"
  on public.conversation_members for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================================
-- POLICIES: MESSAGES
-- =============================================================================
create policy "Members can read messages in their conversations"
  on public.messages for select to authenticated
  using (public.is_conversation_member(auth.uid(), conversation_id) and deleted_at is null);

create policy "Members can send messages to their conversations"
  on public.messages for insert to authenticated
  with check (
    auth.uid() = sender_id
    and public.is_conversation_member(auth.uid(), conversation_id)
  );

create policy "Senders can edit or delete their own messages"
  on public.messages for update to authenticated
  using (auth.uid() = sender_id) with check (auth.uid() = sender_id);

-- =============================================================================
-- POLICIES: MESSAGE ENVELOPES
-- =============================================================================
create policy "Recipient can read their envelopes"
  on public.message_envelopes for select to authenticated
  using (auth.uid() = recipient_user_id);

create policy "Sender can insert envelopes for a message they authored"
  on public.message_envelopes for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_id and m.sender_id = auth.uid()
    )
  );

create policy "Recipient can mark their envelope delivered"
  on public.message_envelopes for update to authenticated
  using (auth.uid() = recipient_user_id) with check (auth.uid() = recipient_user_id);

-- =============================================================================
-- POLICIES: ATTACHMENTS
-- =============================================================================
create policy "Members can read attachments of visible messages"
  on public.message_attachments for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(auth.uid(), m.conversation_id)
        and m.deleted_at is null
    )
  );

create policy "Message sender can add attachments"
  on public.message_attachments for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_id and m.sender_id = auth.uid()
    )
  );

create policy "Message sender can delete their attachments"
  on public.message_attachments for delete to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and m.sender_id = auth.uid()
    )
  );

-- =============================================================================
-- POLICIES: REACTIONS
-- =============================================================================
create policy "Members can read reactions in their conversations"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(auth.uid(), m.conversation_id)
    )
  );

create policy "Members can react to visible messages"
  on public.message_reactions for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(auth.uid(), m.conversation_id)
    )
  );

create policy "Users can remove their own reactions"
  on public.message_reactions for delete to authenticated
  using (auth.uid() = user_id);

-- =============================================================================
-- POLICIES: RECEIPTS
-- =============================================================================
create policy "Members can read receipts in their conversations"
  on public.message_receipts for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(auth.uid(), m.conversation_id)
    )
  );

create policy "Users can insert their own receipts"
  on public.message_receipts for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own receipts"
  on public.message_receipts for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================================
-- POLICIES: COMMUNITIES
-- =============================================================================
create policy "Public communities are discoverable by any authenticated user"
  on public.communities for select to authenticated
  using (visibility = 'public' or public.is_community_member(auth.uid(), id));

create policy "Any authenticated user can create a community"
  on public.communities for insert to authenticated
  with check (auth.uid() = created_by);

create policy "Community owner (creator) can update"
  on public.communities for update to authenticated
  using (
    exists (
      select 1 from public.community_members cm
      where cm.community_id = id and cm.user_id = auth.uid() and cm.is_owner
    )
  ) with check (true);

-- =============================================================================
-- POLICIES: COMMUNITY ROLES
-- =============================================================================
create policy "Members can read community roles"
  on public.community_roles for select to authenticated
  using (public.is_community_member(auth.uid(), community_id));

-- Role mutations flow through server functions (owner/permission checks).

-- =============================================================================
-- POLICIES: COMMUNITY MEMBERS
-- =============================================================================
create policy "Members can read membership of their communities"
  on public.community_members for select to authenticated
  using (public.is_community_member(auth.uid(), community_id));

create policy "Users can join communities as themselves"
  on public.community_members for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own membership"
  on public.community_members for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================================
-- POLICIES: COMMUNITY ROLE ASSIGNMENTS
-- =============================================================================
create policy "Members can see role assignments in their communities"
  on public.community_role_assignments for select to authenticated
  using (public.is_community_member(auth.uid(), community_id));

-- =============================================================================
-- POLICIES: CHANNELS
-- =============================================================================
create policy "Community members can read channels"
  on public.channels for select to authenticated
  using (public.is_community_member(auth.uid(), community_id) and deleted_at is null);

-- Channel creation/update flows through server functions with permission checks.

-- =============================================================================
-- POLICIES: REPORTS
-- =============================================================================
create policy "Reporter can read their own reports"
  on public.reports for select to authenticated
  using (auth.uid() = reporter_id);

create policy "Staff can read all reports"
  on public.reports for select to authenticated
  using (public.is_staff(auth.uid()));

create policy "Any authenticated user can file a report"
  on public.reports for insert to authenticated
  with check (auth.uid() = reporter_id);

-- =============================================================================
-- POLICIES: AUDIT LOGS
-- =============================================================================
create policy "Only admins can read audit logs"
  on public.audit_logs for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- No insert/update/delete policy → append-only via service_role.

-- =============================================================================
-- REALTIME: publish messaging tables
-- =============================================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_envelopes;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.message_receipts;
alter publication supabase_realtime add table public.conversation_members;
alter publication supabase_realtime add table public.conversations;
