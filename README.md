# Fix: messages stuck on "Decrypting…" forever after clearing browser data

Verified with a clean `pnpm run typecheck` (all 9 workspace projects) and a
successful production build.

## Root cause

Each user's private encryption key lives only in that browser's
`localStorage` — never backed up anywhere, by design (that's what makes it
end-to-end). Clearing site data / browsing history wipes it. The app then
generates a brand-new keypair, but the group/DM key stored server-side was
wrapped for the *old* public key, so it can't be unwrapped anymore. A
recovery mechanism already existed (the other participant re-shares the key
when they reopen that conversation), but only fires if they happen to do
that — there was no way to prompt them, and no way for the affected user to
tell what was even happening.

**The bug making it worse:** the "Waiting for access" status pill that would
explain this was coded `hidden sm:flex` — invisible below the `sm` breakpoint,
i.e. **invisible on every phone**. So on mobile, people just saw messages
stuck on "🔒 Decrypting…" forever with zero explanation — exactly what the
screenshot showed.

## What changed

**Status pill (`ChatRoom.tsx`, `DmThread.tsx`)**
- No longer hidden on mobile — icon always shows; the text label collapses
  to icon-only below `sm` to save space, rather than disappearing entirely.
- The "missing" pill is now a tappable button: tapping it both retries
  fetching the key and requests a re-share (see below).

**Honest per-message state**
- Previously every undecrypted message showed "🔒 Decrypting…" forever,
  which reads as "in progress" even when it's actually stuck waiting on
  another person. Now: if the key is confirmed missing, messages/files/voice
  bubbles say "🔒 Waiting for access" instead — same idea, but doesn't imply
  something's actively about to resolve on its own.
- A banner now appears above the message list itself (not just a small
  header pill) when the key is missing, explaining what happened in plain
  language, with a "Restore access" button.

**New: request-key-access endpoint (backend + WS)**
- `POST /groups/{groupId}/keys/request` and `POST /dms/{threadId}/keys/request`
  — the affected user's client calls this (via the pill or the banner
  button). It broadcasts a `group-key-requested` / `dm-key-requested` event
  over the existing group/thread WebSocket channel.
- Any other member/participant currently connected to that same
  conversation, who already holds the decrypted key, responds automatically
  by re-wrapping and re-sharing it for the requester — same re-share
  function already used elsewhere, just triggered on-demand instead of only
  "whenever they next happen to open this chat."
- Rate-limited (5/min per user) since it's a WS broadcast, not free.

## What this does and doesn't fix

**Fixes:** the specific case in the screenshot — stuck forever with no
explanation, and a slow/unreliable recovery path. Now there's a clear
message, an honest status, and an on-demand nudge that resolves things in
seconds if the other person is currently in that conversation (which, for an
active family chat, is often true).

**Doesn't fix:** if the other participant *never* opens that conversation
after your key changes, you're still stuck — the request only reaches
someone who's connected to that specific group/thread channel right now,
not "anywhere in the app." A fully general fix (reaching someone regardless
of what page they're on) would need a new always-on per-user WebSocket
channel, which is a bigger infrastructure change I didn't make here — happy
to scope that separately if this still isn't enough in practice.

**Also out of scope, worth knowing about:** the actual root fix — not
losing the private key at all — would mean backing it up somewhere more
durable than localStorage (e.g. a passphrase-protected export, or
server-side backup encrypted with something only the user knows). That's a
real security-model change, not a quick patch, so I didn't make that call
unilaterally. Worth a conversation if this keeps coming up.
