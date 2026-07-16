# Whispr Backend

This document explains every table and RLS policy that powers Whispr.
Migrations live in `supabase/migrations/`. Typed service functions live in
`src/lib/*.functions.ts` and are the only supported way for the app to reach
the database.

## Design goals

1. **Privacy by architecture.** Message bodies are stored server-side only as
   opaque ciphertext. The database never sees plaintext.
2. **Protocol-agnostic E2EE.** Device tables carry public key slots
   (`public_identity_key`, `public_signed_prekey`, `signed_prekey_signature`,
   `key_algorithm`, `key_version`) sized for Signal Protocol / MLS / your
   choice. No cryptography is invented here; the schema simply gets out of
   the way when a real protocol is integrated.
3. **Public/private split.** Every user has TWO records:
   - `profiles` — safe to expose to any authenticated user (username, display
     name, avatar, bio, status).
   - `account_private` — sensitive settings (recovery email, phone, locale,
     notification and privacy preferences). Owner + staff only.
4. **Multi-device by default.** Every session is bound to a `devices` row.
   Messages carry `sender_device_id`, and E2EE fan-out has its own
   `message_envelopes` table for per-recipient-device ciphertext.
5. **Strict RLS everywhere.** No table is publicly readable by `anon` except
   the discoverable subset of `communities` (via policy).

## Tables

### Identity & account

| Table | Purpose | Who can read |
|---|---|---|
| `profiles` | Public identity: username, display name, avatar, bio, status. | Any authenticated user. |
| `usernames` | Historical ledger of username reservations. | Any authenticated user (for availability lookup). |
| `account_private` | Recovery email, phone, timezone, preferences. | Owner + staff. |
| `user_roles` | `admin` / `moderator` / `support` / `user`. | Owner (own rows) + admins (all). Never client-writable. |

### Devices & sessions

| Table | Purpose | Who can read |
|---|---|---|
| `devices` | Per-device public key material + fingerprint. | Owner only. Peer devices access public keys via a dedicated `get_prekey_bundle` server function, not direct `SELECT`. |
| `sessions` | Active sign-in sessions bound to a device. | Owner only. Owner can revoke. |

### Social graph

| Table | Purpose | Who can read |
|---|---|---|
| `contacts` | Personal address book with nickname + favorite flag. | Owner only. |
| `blocks` | Block list. | Owner only. |

### Messaging

| Table | Purpose | Who can read |
|---|---|---|
| `conversations` | Container for messages: `direct`, `group`, or `channel`. Carries `disappearing_seconds`. | Live members via `public.is_conversation_member`. |
| `conversation_members` | Membership + per-user state (`is_pinned`, `is_archived`, `muted_until`, `last_read_message_id`, `notification_level`). | Live members. |
| `messages` | Envelope: content type, `ciphertext`, algorithm, mention list, timestamps. Body is opaque. | Live members of the conversation. |
| `message_envelopes` | Per-recipient-device ciphertext (Signal-style fan-out). | Recipient user only. |
| `message_attachments` | Storage path + encrypted metadata blob. Content bytes live in Storage encrypted client-side. | Members of the conversation. |
| `message_reactions` | Emoji reactions. | Members. |
| `message_receipts` | Per-user delivery/read state (`pending`/`delivered`/`read`/`failed`). | Members. Owner can toggle read receipts visibility via `account_private.privacy_preferences`. |

### Communities

| Table | Purpose | Who can read |
|---|---|---|
| `communities` | Named spaces: `public` / `private` / `invite_only`. | Any authenticated user for `public`; members for the rest. |
| `community_members` | Membership with `is_owner`, `left_at`, `banned_at`. | Community members. |
| `community_roles` | Per-community roles with a `permissions` JSON bag. | Community members. |
| `community_role_assignments` | Assigns roles to members. | Community members. |
| `channels` | A channel inside a community; backed by a conversation. `is_private` + `allowed_role_ids` support role-gated channels. | Community members. |

### Trust & safety

| Table | Purpose | Who can read |
|---|---|---|
| `reports` | User-submitted reports about content or accounts. | Reporter + staff. |
| `audit_logs` | Append-only trail of privileged actions. | Admins only; writes only via service_role. |

## Helper functions (`SECURITY DEFINER`)

These wrap the recursive-safe pattern for RLS:

- `has_role(uuid, app_role) → boolean` — role membership.
- `is_staff(uuid) → boolean` — user is admin/moderator/support.
- `is_conversation_member(uuid, uuid) → boolean` — user is a live conversation member.
- `is_community_member(uuid, uuid) → boolean` — user is an active community member.

All four are executable by `authenticated` only (revoked from `anon` and `PUBLIC`).

## Realtime

The following tables are added to the `supabase_realtime` publication for
push-driven UI updates: `messages`, `message_envelopes`, `message_reactions`,
`message_receipts`, `conversation_members`, `conversations`.

RLS still applies — Realtime consumers only receive rows they'd be allowed
to `SELECT`.

## Server-side API (typed)

Consumer code should never issue raw Supabase queries. It should call these
`createServerFn`-backed functions:

- **Profile & identity** — `src/lib/profile.functions.ts`:
  `getMe`, `updateMyProfile`, `claimUsername`, `lookupProfileByUsername`,
  `listMyDevices`, `registerDevice`, `revokeDevice`, `listMySessions`,
  `revokeSession`.
- **Contacts** — `src/lib/contacts.functions.ts`:
  `listMyContacts`, `addContact`, `removeContact`, `blockUser`, `unblockUser`,
  `searchUsers`.
- **Messaging** — `src/lib/messaging.functions.ts`:
  `listMyConversations`, `listMessages`, `sendMessage`, `reactToMessage`,
  `markConversationRead`.
- **Communities** — `src/lib/communities.functions.ts`:
  `listMyCommunities`, `discoverPublicCommunities`, `createCommunity`,
  `listChannels`.

Each of these uses `requireSupabaseAuth`, so RLS is enforced as the caller.
Admin operations that must bypass RLS (audit-log writes, role assignments,
scheduled-message delivery) live in `*.server.ts` helpers and load
`supabaseAdmin` inside the handler.

## Encryption boundary — what the server sees vs. what it doesn't

| The server sees | The server does not see |
|---|---|
| Who is talking to whom | What they are saying |
| When a message was sent | The message contents |
| Content type (`text`, `image`, `voice`, …) | The actual text, image bytes, transcript |
| Mention user IDs (for notification fan-out) | Any body text |
| Attachment size + coarse MIME hint | Filename, exact MIME, checksum (encrypted metadata) |
| Reactions (emoji + reactor) | — |
| Read receipts (opt-in per user) | — |
| Device fingerprints (public) | Device private keys |

## Next steps

- **Auth flows**: email/password + Google + magic links + passkeys, using the
  Lovable Cloud managed auth. Wire the `_authenticated` layout, onboarding,
  and the sign-in / sign-up / recovery UI.
- **Chats app**: authenticated `/app` surface consuming
  `listMyConversations` + `listMessages` + realtime.
- **Cryptography integration**: pick and wire the E2EE protocol
  (recommended: libsignal-client via native bindings on mobile / WASM on web).
  The schema needs no changes.
