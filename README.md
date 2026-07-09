# Mavik Connect

A private, warm space for your family to stay close across the distance. End-to-end encrypted group chat with real-time messaging and video calling. No noise, no distractions — just the people you love.

## Features

- **End-to-End Encryption** — Client-side encryption ensures only group members can read messages
- **Real-Time Chat** — WebSocket-powered instant messaging across all group members
- **Video Calling** — WebRTC-based 1:1 video calls within groups
- **Family Groups** — Create invite-only groups, manage members, and share encrypted conversations
- **Cross-Platform** — Works on desktop, tablet, and mobile browsers with responsive design
- **Secure Authentication** — Clerk-powered authentication with proxy support for custom domains

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Wouter
- **Backend**: Express 5, TypeScript, WebSocket (ws)
- **Database**: PostgreSQL, Drizzle ORM
- **Auth**: Clerk
- **Encryption**: Web Crypto API (RSA-OAEP + AES-GCM)
- **Video**: WebRTC
- **API Spec**: OpenAPI 3.1 with Orval codegen
- **Build**: esbuild (server), Vite (client)

## Getting Started

### Prerequisites

- Node.js 24+
- pnpm (enforced via preinstall script)
- PostgreSQL database (connection string via `DATABASE_URL`)
- Clerk account (publishable + secret keys)

### Environment Variables

Create a `.env` file in the project root:

```env
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/mavik_connect
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Optional — restricts CORS in production
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Set automatically by deployment platform
PORT=5000
BASE_PATH=/
```

### Install & Run

```bash
# Install dependencies (pnpm required)
pnpm install

# Push database schema
pnpm --filter @workspace/db run push

# Run API server (port 5000)
pnpm --filter @workspace/api-server run dev

# Run frontend dev server (in another terminal)
pnpm --filter @workspace/family-chat run dev

# Full typecheck across all packages
pnpm run typecheck

# Build all packages for production
pnpm run build
```

### Useful Commands

```bash
# Regenerate API hooks and Zod schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Format all files
pnpm run format

# Check formatting
pnpm run format:check

# Typecheck
pnpm run typecheck
```

## Project Structure

```
.
├── artifacts/
│   ├── api-server/          # Express 5 API + WebSocket server
│   ├── family-chat/         # React SPA (Vite)
│   └── mockup-sandbox/      # Design sandbox
├── lib/
│   ├── api-spec/            # OpenAPI spec + Orval config
│   ├── api-zod/             # Generated Zod schemas
│   ├── api-client-react/    # Generated React Query hooks
│   └── db/                  # Drizzle ORM schema + connection
├── package.json             # Workspace root
├── pnpm-workspace.yaml      # pnpm workspace config
└── tsconfig.base.json       # Shared TypeScript config
```

## Architecture Decisions

1. **OpenAPI-first API design** — The API contract is defined in `lib/api-spec/openapi.yaml` and both Zod schemas and React Query hooks are auto-generated via Orval. This ensures frontend and backend stay in sync.

2. **End-to-end encryption** — Group symmetric keys are generated client-side, encrypted with each member's RSA public key, and stored server-side. Messages are encrypted before sending and decrypted on receipt. The server never sees plaintext.

3. **Monorepo with pnpm workspaces** — Shared packages (`@workspace/db`, `@workspace/api-zod`, `@workspace/api-client-react`) are consumed by both frontend and backend via workspace links, eliminating duplication.

4. **Clerk proxy middleware** — Enables Clerk authentication on custom domains without CNAME DNS configuration by proxying Frontend API requests through the app's own domain.

5. **esbuild for server bundling** — The API server is bundled into a single `.mjs` file with esbuild for fast cold starts and deterministic deployments.

## Security

- **Helmet** — HTTP security headers (HSTS, CSP, X-Frame-Options, etc.)
- **Rate Limiting** — Per-IP and per-user rate limits on API endpoints (300 req/15min general, 60 msg/min, 20 group actions/min)
- **CORS** — Origin-restricted cross-origin requests
- **Input Validation** — All request bodies validated with Zod schemas
- **E2E Encryption** — Server cannot read message content
- **Parameterized Queries** — Drizzle ORM prevents SQL injection

## License

MIT
