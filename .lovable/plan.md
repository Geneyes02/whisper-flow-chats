# Whispr Production Build — Staged Delivery

Your brief is 12 phases spanning auth, real-time messaging, groups, ephemeral rooms, encrypted media, and audited end-to-end encryption. Honestly delivered, that is multiple weeks of work and — per your own rule — the cryptography portion requires specialist review, not an AI one-shot. I will not fake any of it.

Here is how I propose to ship it, in order, one slice per turn. Each slice ends in a working, tested state you can actually use before we move on.

## Slice 1 (this turn) — Audit + Real Auth + Sign-in UI
- Audit current DB (tables already migrated from prior turn: profiles, devices, sessions, conversations, messages + envelopes, communities, etc.). Document gaps against your Phase 1 list (notably: `invites`, `blocks` exists, `user_settings` maps to `account_private`, `message_delivery_state` maps to `message_receipts`, `attachments` = `message_attachments`).
- Add missing tables: `invites` (for 1:1 + group + Drop invitations), `drops` (ephemeral rooms w/ expiry).
- Real auth: email/password + Google OAuth (via `configure_social_auth`), `/auth` route, username claim on first sign-in, `_authenticated/` gate.
- Profile edit + active sessions view + session revoke.

## Slice 2 — Real 1:1 Messaging (server-side ciphertext, NOT E2EE yet)
- `/app` shell: conversation list, message view, composer.
- Real send/receive via `messages` table + Supabase Realtime.
- Delivery + read state, typing indicator, pagination, optimistic send, reconnect.
- **Honest labeling**: UI will say "Encrypted in transit and at rest" — NOT "end-to-end encrypted" — until Slice 4 lands. No security claims we can't back.

## Slice 3 — Groups + Invite Links + Drops
- Create group, invite link (`/i/{token}`), join flow (open → sign in → join → message).
- Drops with TTL + server-side expiry job (pg_cron on Supabase).
- Block, leave, remove member, permissions.

## Slice 4 — E2EE (requires your explicit go-ahead)
- Integrate `libsignal-client` WASM for X3DH + Double Ratchet, OR MLS via `@matrix-org/matrix-sdk-crypto-wasm`.
- Client-side keygen, IndexedDB key storage, per-device envelope fan-out (schema is already ready).
- **I will stop and flag for specialist review** before shipping — per your Phase 3 rule. Key backup/recovery UX is a product decision I need you on.

## Slice 5 — Encrypted Media + Privacy Controls + Abuse Protection
- Private Storage bucket, client-side file encryption, MIME/size validation.
- Disappearing messages enforcement, read-receipt/typing/online toggles.
- Rate limiting (edge middleware), auth throttling, invite abuse caps.

## Slice 6 — Prototype Purge + Production Test + Release Audit
- Grep-and-remove any remaining prototype artifacts on the landing page.
- Playwright end-to-end test with two real accounts covering your Phase 11 journey.
- Final WORKING / PARTIAL / NOT IMPLEMENTED / SECURITY / BLOCKERS report.

## What I need from you before I start
1. **Confirm this staging.** Otherwise tell me to reorder.
2. **Auth methods**: email/password + Google OK, or add magic links / passkeys now?
3. **E2EE library preference** for Slice 4: libsignal (Signal Protocol) or MLS? Or "you decide"?

Reply "go" and I ship Slice 1 immediately.
