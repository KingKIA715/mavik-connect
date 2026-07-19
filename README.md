# Mavik Connect

A private, end-to-end-encrypted messaging app for families and small, close-knit groups — 1:1 direct messages and group chats, with text, voice messages, file sharing, replies, @mentions, and voice/video calls. Messages are encrypted client-side, so the server only ever stores ciphertext and wrapped keys — never plaintext.

---

## Features

- **Groups and direct messages** — create a group, invite people, or start a 1:1 conversation by searching for someone by name or email.
- **Message requests** — starting a new DM with someone sends a *request*, not an open inbox slot. The recipient accepts or declines before the conversation opens up. Declining is a one-directional, permanent block on the person who sent the request — the recipient can still reach out later themselves if they change their mind.
- **Rich messaging** — text, file attachments, voice messages, reply/quote, @mentions, message reactions, edit/delete.
- **System messages** — when someone leaves or is removed from a group, a plain-text system message records it in the chat history for everyone still there.
- **Voice & video calls** — WebRTC calls, signaled over the existing WebSocket connection.
- **Profile** — first/last name and an optional phone number (format-checked, not SMS-verified), editable from Settings.
- **End-to-end encryption** — every user has a client-side RSA-OAEP keypair (private key never leaves the browser); every group/DM has an AES-GCM key, wrapped once per member with that member's public key. The server only ever handles ciphertext and wrapped keys.

---

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces, Node.js 24, TypeScript ~5.9 |
| API server | Express 5, raw WebSocket (`ws`) for real-time messaging/calls |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod v4 (`zod/v4`), `drizzle-zod` |
| API contract | OpenAPI spec, with Zod schemas and React Query hooks generated via **Orval** |
| Frontend | React 19, Vite 7, Tailwind CSS v4, shadcn/ui, wouter (routing), TanStack Query |
| Auth | Clerk |
| Encryption | Client-side RSA-OAEP + AES-GCM, wrap-per-member key sharing |
| Build | esbuild (API server), Vite (frontend) |
| Hosting | Replit |

---

## Repository structure

```
lib/
  db/                        Drizzle schema (source of truth for all tables)
  api-spec/openapi.yaml      OpenAPI spec (source of truth for the HTTP API)
  api-zod/generated/         Zod request/response schemas — generated, don't hand-edit
  api-client-react/generated/ React Query hooks — generated, don't hand-edit
  api-spec/orval.config.ts   Codegen configuration

artifacts/
  api-server/                Express app
    src/routes/               One file per resource (users, groups, dms, messages, activity)
    src/lib/                  Access-control helpers (dmAccess.ts, groupAccess.ts), serialization
    src/ws/                   WebSocket hub (per-group and per-thread connection rooms)
    src/middlewares/          Auth, rate limiting
  mavik-connect/              React frontend
    src/pages/                 Route-level components (ChatRoom, DmThread, Settings, Landing, ...)
    src/components/            Shared components (ChatListSidebar, ui/ — shadcn primitives)
    src/hooks/                  use-encryption.ts (crypto orchestration), use-websocket.ts
    src/lib/crypto.ts           Low-level WebCrypto helpers (keygen, wrap/unwrap, encrypt/decrypt)
  mockup-sandbox/             Unrelated Replit-only sandbox package

.agents/memory/               Design-decision notes worth reading before making changes
  mavik-connect-e2e-encryption.md   The encryption architecture and its accepted tradeoffs
```

---

## Getting started

### Prerequisites
- Node.js 24
- pnpm (`npm install -g pnpm`)
- A PostgreSQL database

### Install

```bash
pnpm install
```

### Environment

Set `DATABASE_URL` to a PostgreSQL connection string. (Clerk and other service credentials are configured via Replit's environment in the hosted deployment — see your Replit project's secrets if running there.)

### Push the database schema

This repo uses `drizzle-kit push` — there are **no migration files**. Schema changes in `lib/db/src/schema/*.ts` are applied directly:

```bash
pnpm --filter @workspace/db run push
```

### Run the API server

```bash
pnpm --filter @workspace/api-server run dev
```

Runs on port 5000 by default.

### Run the frontend

```bash
PORT=5173 pnpm --filter mavik-connect run dev
```

(The frontend's `vite.config.ts` requires a `PORT` env var to be set explicitly.)

---

## Common commands

| Command | What it does |
|---|---|
| `pnpm run typecheck` | Full typecheck across every workspace package |
| `pnpm run build` | Typecheck + build every package |
| `pnpm run lint` / `pnpm run format` | Prettier check / write across the repo |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate Zod schemas + React Query hooks from `openapi.yaml` |
| `pnpm --filter @workspace/db run push` | Push schema changes to the database |

---

## How a change flows through this repo

This is a codegen-driven monorepo — changes to the API generally flow in one direction:

1. **`lib/db/src/schema/*.ts`** — add/change a table or column.
2. **`lib/api-spec/openapi.yaml`** — add/change the corresponding request/response shape.
3. **`pnpm --filter @workspace/api-spec run codegen`** — regenerates:
   - `lib/api-zod/generated/` — Zod schemas the API server validates against
   - `lib/api-client-react/generated/` — React Query hooks the frontend calls
4. **`artifacts/api-server/src/routes/*.ts`** — implement the backend logic, using the generated Zod schemas.
5. **`artifacts/mavik-connect/src/**`** — implement the frontend, using the generated hooks.
6. **`pnpm run typecheck`** — should be clean across all 9 workspace projects before considering anything done.

Files under any `generated/` directory are committed to this repo (not gitignored) — regenerate and commit them together with the `openapi.yaml` change that produced them, rather than hand-editing them or leaving them stale.

---

## Encryption model, in brief

- Each user has an RSA-OAEP keypair. The private key lives only in that browser's `localStorage`, keyed per user id, and is **never** uploaded — only the public key is sent to the server.
- Each group/DM thread has one AES-GCM key, generated client-side and wrapped (RSA-encrypted) once per member/participant with that person's public key. The server stores only wrapped copies.
- If a user loses their browser's `localStorage` (clears data, switches devices, uses a private/incognito window), they lose access to previously wrapped keys and thus old messages — this is an accepted tradeoff of true end-to-end encryption, not a bug. Recovery happens by another participant who still holds the key re-sharing it, either automatically when they next open that conversation or on request via the "Restore access" flow.

See `.agents/memory/mavik-connect-e2e-encryption.md` for the full design rationale before making any encryption-related change.

---

## Known limitations

- No automated test suite yet — verification currently relies on `pnpm run typecheck` and a production build.
- Key recovery for a user who's lost local storage depends on another participant being reachable (either live via WebSocket, or by them reopening the conversation); there's no durable, always-on per-user notification channel yet.
- Phone numbers are format-validated only (E.164), not SMS-verified.
- The `mockup-sandbox` package requires Replit-specific environment variables and won't build in a plain local/CI environment — this is expected and unrelated to the rest of the app.
