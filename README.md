# Trivia Live

A web app for running live, in-person trivia events (Jeopardy-style), built
for a room with **physical buzzers**, a **host tablet**, **team tablets**, and
a **projector/stream display** — all synced to one authoritative game server.

One live game, four modes:

| Mode | URL | Who | What it shows |
| --- | --- | --- | --- |
| **Showrunner** | `/console/session/<CODE>?key=…` | Backstage operator | Full control: teams, buzzer mapping, round flow, score fixes, overrides |
| **Host** | `/host/<CODE>?key=…` | On-stage MC (tablet) | Clue **with answer** + host notes, buzz order, giant Correct/Wrong/Dead buttons |
| **Competitor** | `/team/<CODE>/<teamId>` | Team tablets | Own score, current clue (no answer), buzz status, wager/answer input in final rounds |
| **Audience** | `/audience/<CODE>` | Projector / stream | Broadcast-style board, clue takeover, buzz flash, scores, final podium |

Physical buzzers are the only buzz input (phones/tablets never buzz). Buzzer
hardware talks to the server over HTTP or WebSocket — see
[docs/buzzer-protocol.md](docs/buzzer-protocol.md).

## Round types

Games are composed from an ordered list of rounds (pluggable — see
`server/src/game/rounds/`):

- **Board** — classic categories × values grid; host opens buzzers after
  reading the clue; wrong answers deduct and lock the team out of the clue,
  then the race reopens for everyone else.
- **Quickfire** — sequential questions, flat points, optional flat penalty.
- **Wager (final)** — teams see a topic, wager privately on their tablets
  (clamped server-side to all-in or a cap), type answers, then the host does
  a staged per-team reveal: answer → judged → wager → score.

## Running it

```bash
npm install

# Development (two processes, hot reload)
npm run dev            # server :3001 + Vite web :5173

# Production (single process serving the built app on :3001)
npm run build
npm run start
```

State lives in `data/trivia.db` (SQLite). Point `TRIVIA_DB` somewhere else to
override; `PORT` changes the port.

The server keeps an append-only journal of every game event, so **killing and
restarting it mid-game recovers exactly where it left off** — clients just
reconnect. Scores live in an append-only ledger (`score_events`) too, so every
point ever awarded (including manual adjustments and their reasons) is
auditable.

## Running an event (run-book)

1. **Author content** at `/console`: create a question set (or import JSON —
   the shape is shown in the console; export works too), then compose a game
   from rounds.
2. **Create a session** for the game. You land in the session console; the
   showrunner URL (with its key) is saved in this browser — copy it somewhere
   safe anyway.
3. **Setup tab**: add teams; open the **Screens & links** panel and open each
   URL on the right device (host tablet, team tablets, projector).
4. **Map buzzers**: press each physical buzzer — it appears in the console —
   tap the team it belongs to. Unmapped presses show a warning toast, so a
   forgotten mapping is caught immediately.
5. **Live tab**: Start game → start round 1. The host tablet drives judging;
   you keep the override tools (score adjust with reason, clear lockouts,
   jump rounds, end game).
6. **If hardware dies**: open `/dev/buzzers` on any phone/laptop, enter the
   session code and the team's buzzer ID — it's the same ingest path.
7. **If the server dies**: restart it. Everything resumes.

### Dress-rehearsal checklist

- Run `npm run build && npm run start` on the actual event laptop.
- Join from the real tablets over the venue Wi-Fi (use the laptop's LAN IP).
- Fire every physical buzzer through a full board clue.
- Kill the server mid-clue and restart it. Confirm every screen resumes.

## Testing without hardware

- `/dev/buzzers` — browser simulator; keyboard keys 1–8 race buzzes.
- `node scripts/fake-buzzer.mjs <CODE> B1 5` — scripted buzzes over both
  transports, validating the exact microcontroller protocol.
- `npm test` — unit + integration suite (buzz arbitration races, round state
  machines, role-filtered snapshots, journal-replay recovery).

## Architecture

```
packages/shared/   TypeScript contract: models, live-state views, socket protocol
server/            Express + Socket.IO + better-sqlite3
  src/game/        GameEngine, BuzzArbiter, pluggable round handlers
  src/sockets/     role-authenticated rooms, per-role snapshot fan-out, /buzzers ingest
  src/api/         REST: content authoring, sessions/teams/mappings, HTTP buzz
web/               Vite + React: the four modes + console editors + simulator
```

Design notes:

- **Full-snapshot broadcasts** (no diffing): state is tiny; reconnection is
  bulletproof — connect, get a snapshot, render.
- **Role-filtered projections**: answers/notes are stripped server-side for
  competitor/audience; a team's wager is visible only to staff and that team
  until revealed.
- **Server receive-time buzz ordering**: the only defensible rule without
  synchronized clocks; firmware should optimize send latency.
- **No accounts**: role URLs carry short secrets; competitors/audience just
  need the session code. Right-sized for a LAN event app.
