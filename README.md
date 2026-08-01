# Tic-Tac-Toe PWA — two players, real-time, best of three

A minimalistic, installable Progressive Web App for a 2-player Tic-Tac-Toe match, synchronized
in real time through Supabase (Postgres + Realtime). Play happens in shareable **sessions**:

- the player who creates a session gets a 6-character **code** and plays **X**,
- the opponent joins with that code and plays **O**,
- symbols **alternate between sets** (best of three), so the player who starts first is
  shared fairly across the match,
- winner is the first player to win **2 out of 3 sets** (draws award no point),
- if a player disconnects mid-match the game pauses and a new player can join with the same code.

## Stack

React 18 + TypeScript + Vite, Supabase (Postgres + Realtime), vite-plugin-pwa (Workbox
service worker + manifest), plain CSS (mobile-first).

## How the synchronization works

Every session lives in its own row of the Supabase `room` table, keyed by its `code`:

| Mechanism  | How it works                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Real-time  | Each client subscribes with `postgres_changes` (Realtime) filtered by its code; any write by one player is pushed to the other. |
| Presence   | Each seated client refreshes its `lastSeen` (server epoch ms) every 3 s via the `heartbeat` RPC. A seat older than |
|            | 12 s is treated as free.                                                                                           |
| Session    | `create_session` generates a code and seats the creator (X); `join_session` seats the opponent (O) — or re-seats a |
|            | returning player. The game starts the moment both seats are held.                                                   |
| Moves      | `record_move` derives the mover's symbol from their seat + the set number and re-validates phase, turn, empty cell |
|            | and opponent presence under a row lock before committing.                                                           |
| Match flow | The same function advances the board, the set score and the match result atomically; the set number flips who plays X. |

All mutations run as server-authoritative database functions; anonymous clients can only
**select** the room row.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the migrations in `supabase/migrations/` (they create the
   `room` table, the session functions, RLS policies and the Realtime publication).
3. Copy `.env.example` to `.env` and export/fill in `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY` from **Project Settings → API** (the project URL and the public
   `sb_publishable_...` key). The `SUPABASE_*` names match your GitHub Actions variable/secret,
   so the same values are reused in CI.
4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

5. Build for production (PWA assets + service worker are generated):

   ```bash
   npm run build
   npm run preview
   ```

## Playing across two devices

On the first device tap **New game** and share the generated 6-character code with the second
device; on the second device tap **Join game** and enter the code. The creator plays X first; the
symbols swap every set, best of three. A refresh (or even a new device) can re-join with the same
code as long as a seat is free.

## Tests

```bash
npm test        # unit tests for the pure game engine
npm run test:e2e  # full two-player lifecycle against your hosted Supabase project
```

The E2E suite needs `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env` (it calls the
`reset_room` RPC to start from a clean state) and a Vite dev server on `localhost:5173`, which
Playwright starts automatically.

## CI/CD

`.github/workflows/ci.yml` runs on every push to `main` (and `workflow_dispatch`):

1. **Build & test** — `npm ci`, typecheck, unit tests, production build.
2. **Deploy backend** — `supabase link` + `supabase db push` applies pending files in
   `supabase/migrations/`, then verifies the `room` table exists.
3. **Deploy PWA** — builds with the Supabase config baked in and publishes `dist/` to
   Cloudflare Pages via Wrangler.

Required GitHub Actions secrets:

| Secret | Where to find it |
| ------ | ---------------- |
| `SUPABASE_ACCESS_TOKEN` | Supabase Dashboard → Account → Access Tokens (`sbp_...`) |
| `SUPABASE_PROJECT_ID` | Supabase Dashboard → Project Settings → General (the project ref) |
| `SUPABASE_DB_PASSWORD` | Supabase Dashboard → Project Settings → Database |
| `SUPABASE_URL` | Project Settings → API (`https://<ref>.supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Project Settings → API (`sb_secret_...`, used for the post-deploy check) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens (Pages edit permission) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard URL / Workers & Pages overview |
| `CLOUDFLARE_PAGES_PROJECT` | Cloudflare Pages project name (variable; defaults to `tik-tak-toes`, also honors `CLOUDFLARE_PROJECT_NAME`) |

## Project layout

```
src/
  game/engine.ts          pure game rules (winner detection, initial room)
  services/gameService.ts all Supabase reads/writes/RPCs (the sync layer)
  hooks/useGameRoom.ts    React binding: seating, heartbeat, disconnect detection
  components/             board, cells, scoreboard, overlays, screens
  supabase/client.ts      Supabase client from env vars
public/
  offline.html            offline splash screen
  icons/                  generated app icons
supabase/migrations/      SQL: room table, game RPCs, RLS, Realtime
```

## Notes

- `sessionStorage` holds the player session, so a **refresh keeps your seat** while a new
  tab counts as a new visitor.
- Because the game is real-time multiplayer it requires an internet connection; the PWA
  is still installable and ships an offline splash page for when the connection is missing.
- The Supabase `anon` key is public by design; the SECURITY DEFINER functions (with row
  locks) are what keep the game fair.
