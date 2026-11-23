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
If they don't return in time, or press **Leave**, the game ends for everyone.

## How it works (and its limits)

- Every device runs the whole game with the same random seed. Each player's input is sent to the server,
  which echoes it to everybody in one order (and logs it for rejoiners), so all devices stay identical.
  Computer players run on every device and decide identically thanks to the shared seed.
- Because every device holds the full game state, a determined player could peek at hidden cards with
  developer tools. Fine for friends; not for tournaments.
- Rooms and logs live in server memory; restarting the server ends them. A room's log is capped (30 000 inputs / 8 MB),
  far beyond any real game.

## Tests

```bash
node server.test.js                              # relay server: rooms, rejoin, grace period, PWA files (no browser)
cd ../game-night-tests && node online.test.js    # 2–4 real game clients playing each other, incl. bots, drops and page reloads (needs Chromium)
```

## Chat

`{t:'chat', k:'e', i}` (emoji reaction, index 0–7), `{t:'chat', k:'t', s}` (text, ≤ 200 chars) and `{t:'chat', k:'v', mt, a}` (base64 audio clip ≤ ~32 KB, `audio/*` only) are validated, rate-limited
(0.3 s / 1.5 s per player) and relayed to the *other* seats. They are not logged, so a rejoining player does not replay them.
