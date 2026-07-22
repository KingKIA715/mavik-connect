# Mavik Connect — Full changeset (supersedes all earlier zips)

Cumulative — everything from every earlier delivery plus DM/group call
ringing+history and the full push notification stack. Only this zip is
needed.

## Apply

```bash
cd mavik-connect
git apply --index /path/to/mavik-connect-full.patch
git status
```

Or copy `changed-files/` over your working tree by hand, then separately:
```bash
rm artifacts/mavik-connect/src/pages/ChatListSidebar.tsx   # dead duplicate
```

## Before committing — this round has real setup steps, not just a migration

1. **`pnpm install`** — new dependency: `web-push` (+ `@types/web-push`) in
   `artifacts/api-server`.

2. **Run the DB migration** — new tables/columns across all deliveries:
   - `dm_threads.user_a_muted_at`, `dm_threads.user_b_muted_at`
   - `group_members.muted_at`
   - **new table** `dm_calls`
   - **new table** `group_calls`
   - **new table** `push_subscriptions`
   ```bash
   cd lib/db && pnpm drizzle-kit push
   ```

3. **Generate your own VAPID keys** — required for push notifications to
   actually send. I generated an example pair while building this purely
   to verify the wiring; it is NOT included anywhere in this delivery.
   Generate your own and set them as real environment variables in your
   deployment (never commit them):
   ```bash
   npx web-push generate-vapid-keys
   ```
   Then set on the api-server:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (a `mailto:` address or URL identifying you to push
     services — optional, defaults to a placeholder if unset)

   If these aren't set, push notifications are silently disabled — core
   messaging/calling is completely unaffected either way.

4. `pnpm run typecheck` — clean across every workspace.
5. Build: frontend (`vite build`) and `api-server` (`node build.mjs`) both
   verified clean.
6. Prettier applied.

## What's new in this delivery

**Merged call buttons**: one "Call" button (was two) in both group and DM
headers, opens a dropdown to choose voice or video.

**DM call ringing + history**: calling previously only worked if both
people happened to already be on the call screen — no ring, no missed-call
concept at all. Now:
- New app-wide WebSocket scope (`/api/ws?scope=user`) rings a call no
  matter what page you're on, without touching the existing (working)
  WebRTC media signaling at all.
- 45-second ring timeout auto-finalizes as "missed".
- Any terminal state (missed/declined/cancelled/ended) writes a compact,
  unencrypted summary inline into the conversation — "Missed video call",
  "Voice call declined", "Voice call · 4:12" — same pattern as system
  messages, no new UI surface.
- Full incoming-call banner with Accept/Decline, mounted at the app root
  so it works from any page (including Settings).

**Group calls**: deliberately simpler — no ring, no per-person missed
tracking (a shared room doesn't have a clean "missed" concept). Just logs
that a call happened and its duration once the last person leaves.

**Fixed a permanent-block bug**: if someone rejects a DM message request
and later messages back, the thread now auto-reopens instead of leaving
the original sender blocked forever.

**Fixed unreliable DM key delivery**: the recipient's encryption key
previously only arrived if the sender happened to revisit that exact
conversation page. Now self-heals from anywhere in the app.

**Push notifications** — the full stack:
- New message (DM or group) → generic "New message from X" push, only if
  the recipient isn't already online (never redundant with a live
  WebSocket delivery, and never contains message content — the server
  doesn't have the plaintext anyway, since messages are E2E encrypted).
- Incoming DM call → push if the callee isn't online at all.
- Missed/cancelled DM call → "Missed call from X" push.
- Real service worker `push`/`notificationclick` handlers — clicking a
  notification focuses/navigates an existing tab or opens one.
- Settings > Notifications: a real toggle, correctly showing "blocked in
  browser" vs. "not supported" states.
- A genuinely soft, one-time prompt after your first sent message — never
  a cold browser permission popup on login, never shown twice.

**Also includes everything from the earlier quick-wins/features batch**:
dead file cleanup, presence indicators, image lightbox, unread divider,
drag-and-drop upload, dark mode, per-thread mute, message-request rate
limiting.

## Suggested commit message

```
Add DM/group call ringing+history, push notifications; merge call
buttons; fix DM reject/reopen block + unreliable key delivery

- One "Call" button (voice/video dropdown) instead of two, groups + DMs
- Real call ringing via a new app-wide WebSocket scope — previously
  calling only worked if both people happened to already be on the call
  screen
- Call history logged inline in the conversation (missed/declined/
  duration), for both DMs (full state machine) and groups (simpler,
  duration only)
- Full Web Push stack: message + call notifications, service worker
  handlers, Settings toggle, soft one-time permission prompt
- Auto-reopen a rejected DM thread when the recipient messages back
- Self-heal missing DM encryption keys app-wide, not just on-page

Also includes the earlier quick-wins/features batch (see prior deliveries
for full detail): dead-code cleanup, presence, image lightbox, unread
divider, drag-and-drop upload, dark mode, per-thread mute, request rate
limiting.
```

## Full list of changed files

See `mavik-connect-full.patch` for the exact diff, or use `git status`
after applying it. Highlights of what's new/added this round:

**Added**
- artifacts/api-server/src/lib/dmCalls.ts
- artifacts/api-server/src/lib/groupCalls.ts
- artifacts/api-server/src/lib/push.ts
- artifacts/api-server/src/routes/dmCalls.ts
- artifacts/api-server/src/routes/push.ts
- artifacts/mavik-connect/src/components/IncomingCallBanner.tsx
- artifacts/mavik-connect/src/components/NotificationPromptBanner.tsx
- artifacts/mavik-connect/src/hooks/use-user-websocket.ts
- artifacts/mavik-connect/src/hooks/use-push-notifications.ts
- artifacts/mavik-connect/src/lib/notification-prompt.ts
- lib/db/src/schema/pushSubscriptions.ts

**Modified (notable)**
- artifacts/api-server/src/routes/dms.ts, messages.ts, groups.ts,
  routes/index.ts, ws/hub.ts, ws/server.ts
- artifacts/mavik-connect/src/App.tsx, pages/DmThread.tsx,
  pages/ChatRoom.tsx, pages/DmVideoCall.tsx, pages/VideoCall.tsx,
  pages/Settings.tsx, public/sw.js
- lib/api-spec/openapi.yaml, lib/db/src/schema/dms.ts,
  lib/db/src/schema/messages.ts
- artifacts/api-server/package.json, pnpm-lock.yaml (web-push added)

**Deleted**
- artifacts/mavik-connect/src/pages/ChatListSidebar.tsx (unused duplicate)
