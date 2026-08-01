# Tic-Tac-Toe PWA — two players, real-time, best of three

A minimalistic, installable Progressive Web App for a single 2-player Tic-Tac-Toe match,
synchronized in real time through Supabase (Postgres + Realtime). No rooms, no codes, no accounts:

- first connection becomes **Player X**, second becomes **Player O**,
- any further visitor is rejected until the match ends or a player disconnects,
- winner is the first player to win **2 out of 3 sets** (draws award no point),
- if a player disconnects mid-match the game pauses and a new player takes the seat.

## Stack

React 18 + TypeScript + Vite, Supabase (Postgres + Realtime), vite-plugin-pwa (Workbox
service worker + manifest), plain CSS (mobile-first).

## How the synchronization works

Everything lives in **one** row of the Supabase `room` table:

| Mechanism  | How it works                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Real-time  | Every client subscribes with `postgres_changes` (Realtime); any write by one player is pushed to the other.       |
| Presence   | Each seated client refreshes its `lastSeen` (server epoch ms) every 3 s via the `heartbeat` RPC. A seat older than |
|            | 12 s is treated as free.                                                                                           |
| Seating    | `claim_seat` (a SECURITY DEFINER function) takes the first free/stale seat, or — only when *both* seats are gone — |
|            | resets the room to a fresh `waiting` room (the waiting room never reopens for a live match).                       |
| Moves      | `record_move` re-validates phase, turn, empty cell and opponent presence under a row lock before committing.       |
| Match flow | The same function advances the board, the set score and the match result atomically.                               |

All mutations run as server-authoritative database functions; anonymous clients can only
**select** the room row.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run `supabase/migrations/0001_init.sql` (it creates the
   `room` table, the game functions, RLS policies and the Realtime publication).
3. Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from **Project Settings → API**.
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

Run the app on two different browsers/devices (or two private windows) and open the same URL.
The first visitor is X, the second is O; everyone else sees the “Game already started” screen.

## Tests

```bash
npm test        # unit tests for the pure game engine
npm run test:e2e  # full two-player lifecycle against your hosted Supabase project
```

The E2E suite needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` (it calls the
`reset_room` RPC to start from a clean state) and a Vite dev server on `localhost:5173`, which
Playwright starts automatically.

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
