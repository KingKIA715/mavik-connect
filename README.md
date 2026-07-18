# Reply/Quote, Voice Messages, @Mentions — implementation

All three features, implemented against your actual repo (cloned fresh from
GitHub) and verified with a full `pnpm run typecheck` across all 9 workspace
packages — clean, no errors.

## What's in here

Files are laid out under the same paths as your repo, so you can copy them
straight over. `hand-written-changes.diff` is a unified diff of everything
I wrote by hand (schema, OpenAPI, routes, frontend) — the codegen output
(`lib/api-zod/**/generated`, `lib/api-client-react/**/generated`) is included
as full files rather than a diff since it's machine-generated and you'll want
to just overwrite + re-run `pnpm --filter @workspace/api-spec run codegen`
yourself anyway once the OpenAPI spec is in place, to be sure it's in sync.

### 1. DB schema (`lib/db/src/schema/messages.ts`, `dms.ts`)
- `replyToId` — self-referencing FK (`on delete set null`), same column on
  both `messages` and `dm_messages`.
- `durationSeconds` — nullable int, for voice playback length.
- `mentionedUserIds` — plaintext `text[]` on `messages` only (mentions don't
  make sense in a 1:1 DM). This is deliberately plaintext alongside the
  E2E-encrypted `content`, same tradeoff you already made for reactions —
  the server needs to know *who* was tagged to route/highlight it, but never
  sees *what* was said.

You'll need to run your usual `drizzle-kit push` (or generate+run a
migration, whichever this project uses) against a real database — I didn't
have one available in this sandbox to push against.

### 2. OpenAPI spec (`lib/api-spec/openapi.yaml`)
- `type` enum extended to `[text, file, voice]` on `Message`/`DmMessage`.
- New `MessageReplyPreview` schema — a denormalized snapshot (id, sender,
  content, type, fileName, deletedAt) so a reply can render a quoted snippet
  even if the original message isn't in the currently-loaded page.
- `replyToId`/`replyTo`, `durationSeconds`, `mentionedUserIds` added to the
  request/response schemas as appropriate.

### 3. Backend (`artifacts/api-server`)
- `lib/groupAccess.ts`: added `getGroupMemberIds` to validate @mention
  targets are actually current group members (invalid IDs are silently
  dropped, not trusted as-is).
- `routes/messages.ts` / `routes/dms.ts`: send/list/edit/delete/reactions
  all thread through `replyToId` (validated against the same group/thread),
  `durationSeconds`, and — groups only — `mentionedUserIds`. A batched
  helper (`getReplyPreviewsByReplyToId` / `getDmReplyPreviewsByReplyToId`)
  fetches reply previews in one extra query per page, same pattern as the
  existing reactions batching.
- No changes needed to the WS hub — it just rebroadcasts the same message
  payload, so new fields ride along automatically.

### 4. Frontend (`artifacts/family-chat`)
- **Reply/Quote**: hover a message to see a reply icon; picking it shows a
  preview bar above the composer, and sent replies render a quoted snippet
  (tap it to scroll to the original) above the bubble.
- **Voice messages**: mic button records via `MediaRecorder` (capped at 2
  minutes), sends through the exact same `encryptFile` path as file
  attachments with `type: "voice"` — new `VoiceBubble` component with
  play/pause and a progress bar.
- **@Mentions** (groups only): typing `@` opens an autocomplete of current
  members; selecting one inserts `@Name`. Mentioned names render highlighted
  in the sent message (your own mentions get a distinct highlight color).
  DMs skip this — only two people in the thread, so tagging is redundant.

## Not done / left for you
- No DB migration was run — no live Postgres in this sandbox.
- Push notification copy for "you were mentioned" — the data (`mentionedUserIds`)
  is there, but I didn't touch `routes/activity.ts`; wire it in if you want a
  distinct mention notification vs. a regular new-message one.
- Waveform visualization on voice messages — shipped a simple progress bar
  instead; a real waveform needs decoding audio samples client-side, which
  felt like scope creep for this pass.
