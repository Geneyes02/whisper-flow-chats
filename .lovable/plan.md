# Whispr → Telegram-Parity Build Plan

Honest framing: Telegram is ~12 years of work by a large team. I can't ship all of it in one turn, but I can push hard and land the features that make Whispr *feel* on par. I'll execute the slices below back-to-back in this same session unless you redirect.

## What "Telegram-parity" means here

Core surfaces I'll build:

1. **Rich Messaging** — reply-to, edit, delete-for-me/everyone, forward, reactions (emoji), pinned messages, typing indicators, read receipts, message search.
2. **Media & Files** — image/video/file uploads via Cloud Storage, thumbnails, voice notes (record + waveform), inline previews, drag-drop.
3. **Groups & Channels** — group chats (up to N members), broadcast channels, admin roles, invite links, join requests, member list, mute.
4. **Presence & Status** — online/last-seen, typing, per-chat mute, unread badges, chat pinning, archive.
5. **Discovery** — username search, contacts sync, "people you may know", QR-code invite/add.
6. **Drops (ephemeral)** — self-destruct timers per chat, "view once" media, disappearing invite rooms.
7. **Notifications & Sessions** — web push notifications, per-device session manager, remote logout, login alerts.
8. **App Polish** — full-screen media viewer, chat theming, emoji picker, keyboard shortcuts, mobile-responsive layout, PWA offline shell for message cache.

## What I will NOT do in this pass

- **Client-side E2EE** (Signal/MLS). You already accepted "encrypted in transit + at rest" labeling until specialist review. Adding real E2EE on top of reactions/edits/media is a separate specialist project — I'll flag hooks so it slots in later without a rewrite.
- **Native voice/video calls** (WebRTC SFU). Real calls need a media server (LiveKit/mediasoup) — I can add a LiveKit integration as a follow-up if you want; not in this pass.
- **Bots API / Mini Apps / Payments / Stickers marketplace.** Out of scope for parity-feel; can be added later.
- **Secret Chats** (device-bound). Depends on E2EE.

If you want any of the "will not" items, say so and I'll re-plan.

## Execution order (I'll ship in this order)

**Phase A — Messaging depth** (biggest UX gap)
- DB: `message_reactions`, `message_reads`, `typing_events`, columns for `reply_to_id`, `edited_at`, `deleted_at`, `forwarded_from_id`, `pinned_at`.
- Server fns: react, unreact, edit, delete, forward, mark-read, set-typing, pin/unpin, search.
- UI: message hover actions, reply composer, reaction bar + picker, edited/deleted states, pinned banner, search bar.
- Realtime: reactions, reads, typing, edits, deletes broadcast.

**Phase B — Media & files**
- Storage bucket `chat-media` with per-conversation RLS.
- Upload pipeline (drag-drop, paste, click), image compression client-side, thumbnails.
- Voice notes: MediaRecorder → wav, waveform render, inline player.
- Full-screen viewer (images/video), file cards.

**Phase C — Groups, channels, invites**
- Extend existing `communities` model to real group chats + broadcast channels.
- Invite links (`/join/:token`), join-request flow, admin/moderator/member roles enforced in RLS.
- Member sheet, mute chat, leave, kick, promote.

**Phase D — Presence, notifications, sessions**
- `presence` table + Realtime presence channel for online/last-seen.
- Per-chat mute + unread counters, pinned chats, archive.
- Web Push (VAPID) opt-in + service worker for push.
- Sessions list already exists; add device labels, current-session marker, "log out everywhere".

**Phase E — Discovery + Drops + Polish**
- QR add, username search improvements, contact suggestions.
- Ephemeral chat timers (auto-delete on server after N seconds after read).
- Emoji picker, keyboard shortcuts, mobile layout pass, chat theming, better skeletons.

## Technical Details

- **Stack:** existing TanStack Start + Supabase (Lovable Cloud) + Realtime. No new frameworks.
- **Payloads still `bytea` opaque blobs** so future E2EE swap doesn't require another migration.
- **RLS helpers** (`is_conversation_member`, role check) extended to cover reactions/reads/media/roles.
- **Storage:** Supabase Storage bucket, signed URLs only, path = `conversation_id/message_id/filename`.
- **Realtime channels:** one per conversation for messages/reactions/reads/typing; global presence channel for online.
- **Push:** VAPID keys as secrets, `web-push` invoked from a server function on new message when recipient offline.
- **Performance:** paginated message loading (cursor on created_at), virtualized list for long threads.

## What I need from you

Nothing to start — I'll execute Phase A now and continue straight through. Two optional decisions that would change scope:

- **Want native calls (WebRTC via LiveKit)?** Say yes and I'll add a Phase F.
- **Want E2EE re-scoped in now** with an "Experimental — unaudited" banner? Otherwise it stays deferred for specialist review.

Approve and I'll start Phase A immediately.