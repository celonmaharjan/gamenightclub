# Game Night — online server

`server.js` is a tiny relay (no npm install, Node 14+). It serves `game-night.html` plus the app-install files
(manifest, service worker, icons in `assets/`) and relays game messages between players in a room.
It contains no game logic.

## Play with friends on the same Wi-Fi

```bash
cd game-night-server
node server.js
```

It prints addresses like `http://192.168.1.20:8787`. Everyone opens that address on their phone/computer, then:

1. **🌐 Play Online** → the host taps **Create room** and gets a 4-letter code.
2. Friends tap **📤 Share invite link** (or just read out the code). Opening the link pre-fills the code — they type a name and tap **Join**.
3. The host picks a game and options, optionally fills empty seats with **🤖 computer players**, and taps **Start**.

## Play over the internet

Run `server.js` anywhere that runs Node (a small VPS, Render, Fly.io, Railway, a Raspberry Pi with a
tunnel such as Cloudflare Tunnel or ngrok). Share its `https://…` address — the page automatically uses
`wss://`. `PORT=9000 node server.js` changes the port; `GET /health` is a health check.
Installing the app and offline mode need HTTPS (or `localhost`) — browsers only allow service workers on secure origins.

You can also open a local copy of `game-night.html` and type the server address (`ws://host:8787`) in the
Play Online sheet — but a page loaded from `https://` can only talk to a `wss://` server.

## Reconnecting

If a player's connection drops (Wi-Fi hiccup, phone sleeps, tab reloads) the server **holds their seat for 2 minutes**
(`GN_GRACE_MS=120000`). The game pauses on their turn and everyone sees "X lost connection — waiting…". The player's
page reconnects by itself, replays the room's message log in fast-forward, and picks up exactly where the others are.
A page reload mid-game also rejoins automatically (the seat token is kept in `sessionStorage`).
If they don't return in time, or press **Leave**, **a computer player takes over their seat** and the game continues.

## Host controls and spectators

- The host can remove a player (✕ in the lobby, or in the 💬 panel during a game). Mid-game a computer takes the seat.
- Anyone can **👀 Watch** a started game with its room code (up to 10 spectators per room). Spectators get the replay log and
  live moves, but cannot move or chat.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | 8787 | Port to listen on (Render sets this) |
| `GN_GRACE_MS` | 120000 | How long a dropped player's seat is held |
| `ALLOWED_ORIGINS` | – | Extra web origins allowed to connect, comma-separated (by default only pages served by this server, or a local file talking to `localhost`) |
| `TRUST_PROXY` | – | Use `X-Forwarded-For` for per-IP limits (automatic on Render) |
| `GN_MAX_CONN_PER_IP` | 40 | Open WebSocket connections per IP |
| `GN_ROOMS_PER_IP` | 12 | New rooms per IP per 10 minutes |

Built-in limits: 500 rooms, 8 MB log per room and 256 MB in total, rooms idle for 6 hours are closed,
60 messages/second per connection, a light profanity mask on names and chat.

## How it works (and its limits)

- Every device runs the whole game with the same random seed. Each player's input is sent to the server,
  which echoes it to everybody in one order (and logs it for rejoiners), so all devices stay identical.
  Computer players run on every device and decide identically thanks to the shared seed.
- Because every device holds the full game state, a determined player could peek at hidden cards with
  developer tools. Fine for friends; not for tournaments.
- **Computer takeover** is a `{k:'bot', seat}` message the *server* inserts into the global order (and the log), so every device
  switches that seat to a computer at exactly the same point.
- **Desync check:** every 5 inputs the host sends a hash of its game state (`{k:'h'}`); other devices compare it with theirs and
  re-sync (reconnect + replay) if it differs.
- Rooms and logs live in server memory; restarting the server ends them. A room's log is capped (30 000 inputs / 8 MB),
  far beyond any real game.

## Tests

```bash
node server.test.js                              # relay server: rooms, rejoin, grace, takeover, spectators, kick, limits, chat, PWA files
cd ../game-night-tests && node online.test.js    # 2–4 real game clients playing each other, incl. bots, drops and page reloads (needs Chromium)
```

## Chat

`{t:'chat', k:'e', i}` (emoji reaction, index 0–7), `{t:'chat', k:'t', s}` (text, ≤ 200 chars) and `{t:'chat', k:'v', mt, a}` (base64 audio clip ≤ ~32 KB, `audio/*` only) are validated, rate-limited
(0.3 s / 0.4 s / 0.7 s per player) and relayed to the *other players* (not spectators); allowed in the lobby too. They are not logged, so a rejoining player does not replay them.
