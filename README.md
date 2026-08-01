# Tic-Tac-Toe PWA — two players, real-time, best of three

A minimalistic, installable Progressive Web App for a single 2-player Tic-Tac-Toe match,
synchronized in real time through Firebase Firestore. No rooms, no codes, no accounts:

- first connection becomes **Player X**, second becomes **Player O**,
- any further visitor is rejected until the match ends or a player disconnects,
- winner is the first player to win **2 out of 3 sets** (draws award no point),
- if a player disconnects mid-match the game pauses and a new player takes the seat.

## Stack

React 18 + TypeScript + Vite, Firebase Firestore (realtime sync), vite-plugin-pwa (Workbox
service worker + manifest), plain CSS (mobile-first).

## How the synchronization works

Everything lives in **one** Firestore document, `rooms/game`:

| Mechanism  | How it works                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| Real-time  | Every client subscribes with `onSnapshot`; any write by one player is pushed to the other in milliseconds.      |
| Presence   | Each seated client writes a `lastSeen` server timestamp every 3 s. A seat older than 12 s is treated as free.   |
| Seating    | Claiming a seat is a transaction: take the first free/stale seat, or — only when *both* seats are gone — reset  |
|            | the room to a fresh `waiting` room (the waiting room never reopens for a live match).                           |
| Moves      | Every move is a transaction that re-validates phase, turn, empty cell and opponent presence before committing.  |
| Match flow | The same transaction advances the board, the set score and the match result atomically.                         |

## Setup

1. Create a Firebase project and enable **Cloud Firestore** (production mode).
2. Add a **Web app** in Project settings → General.
3. Copy `.env.example` to `.env` and paste the `VITE_FIREBASE_*` values.
4. Deploy the rules so the app can read/write the room document:

   ```bash
   npm i -g firebase-tools
   firebase login
   firebase init firestore   # accept the existing firestore.rules file
   firebase deploy --only firestore
   ```

   (For a quick test you can switch Firestore to test mode instead.)

5. Install and run:

   ```bash
   npm install
   npm run dev
   ```

6. Build for production (PWA assets + service worker are generated):

   ```bash
   npm run build
   npm run preview
   ```

## Playing across two devices

Run the app on two different browsers/devices (or two private windows) and open the same URL.
The first visitor is X, the second is O; everyone else sees the “Game already started” screen.

## Project layout

```
src/
  game/engine.ts          pure game rules (winner detection, initial room)
  services/gameService.ts all Firestore reads/writes/transactions (the sync layer)
  hooks/useGameRoom.ts    React binding: seating, heartbeat, disconnect detection
  components/             board, cells, scoreboard, overlays, screens
  firebase/               Firebase init + config from env vars
public/
  offline.html            offline splash screen
  icons/                  generated app icons
firestore.rules           security rules for the single room document
```

## Notes

- `sessionStorage` holds the player session, so a **refresh keeps your seat** while a new
  tab counts as a new visitor.
- Because the game is real-time multiplayer it requires an internet connection; the PWA
  is still installable and ships an offline splash page for when the connection is missing.
- The Firebase web config (including `apiKey`) is public by design; Firestore rules and
  the server-side transaction checks are what keep the game fair.
