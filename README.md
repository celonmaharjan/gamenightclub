# 🎲 Game Night

A game hub in **one HTML file** — no libraries, no images, no build step. Open it in any browser (phone or desktop).
Six classic games, playable against the computer, by passing the device around, or **online with friends**.

| Game | Players | Notes |
|---|---|---|
| **Ludo** | 2–4 | 15×15 board, safe ★ squares, blocks, hopping tokens, optional extra turns |
| **Snakes & Ladders** | 2–4 | A brand-new random board every game, snakes slide your pawn down their bodies |
| **Tic-Tac-Toe** | 2 | Unbeatable minimax on Hard |
| **Connect Four** | 2 | Falling discs, alpha-beta lookahead AI |
| **Checkers** | 2 | Forced captures, multi-jumps, kings, minimax AI |
| **Crazy Eights** | 2–4 | 52-card deck, wild 8s, optional action cards, "LAST CARD!" call, scores across rounds |

## Quick start

```bash
open game-night.html          # or double-click it — it works straight from disk
```

Pick a game → choose **Play vs Computer** or **Pass & Play** → set skill (Easy / Medium / Hard), players and names → **Start**.

### Features

- **Skill levels** for every computer opponent; **game options** (Ludo blocks / bonus turns, Crazy Eights action cards)
- **Undo** (Tic-Tac-Toe, Connect Four, Checkers), **auto-save & Resume** for every game, per-game **rules sheet**
- **Win tally**, confetti winner screen, **Play Again**
- **Board themes** (Classic, Neon, Pastel), sound effects (Web Audio) with mute, optional background music
- Responsive from 360 px wide, landscape layout, keyboard play, screen-reader turn announcements, colour-blind-safe Ludo tokens
- Remembers your last game, names and settings (`localStorage`)
- Installable app (PWA) with offline single-player, when served by `server.js`

## Play online

Online play needs the small relay server (zero dependencies, Node 14+):

```bash
cd game-night-server
node server.js                # prints http://<your-ip>:8787 — everyone opens that address
```

Tap **🌐 Play Online** → host creates a room and shares an **invite link** (or the 4-letter code) → friends join → host picks a
game, can **fill empty seats with computer players**, and starts.

- **Chat:** in an online game tap 💬 for **text chat** (with an unread badge), **emoji reactions** (each plays a little sound) and **voice**:
  tap 🎤 once to keep your mic open, tap again to stop — or hold it for push-to-talk. Voice goes out as 3-second clips played one after another
  (not true live streaming); "Voices off" mutes incoming clips. Voice needs HTTPS or `localhost` and microphone permission; text and reactions work anywhere.
- **Reconnect:** if your connection drops or you reload the page, your seat is held for 2 minutes and the game catches you up automatically.
- **Install it:** when served by the server over HTTPS (or `localhost`) the app is installable (📲 button / browser "Add to Home screen")
  and single-player works offline.

See [`game-night-server/README.md`](game-night-server/README.md) for hosting on the internet and how sync works.

**Limits:** voice is short push-to-talk clips relayed through the server (not live streaming), and are not stored or replayed on reconnect; every device holds the full game state, so a determined player could peek at hidden cards via developer tools;
if someone doesn't return within 2 minutes (or presses Leave) the game ends for everyone.

## Project layout

```
game-night.html          the whole app (CSS + JS in one file)
game-night-server/       online relay server + its tests + README
game-night-tests/        logic, browser-bot and online end-to-end tests
CLAUDE.md                guidance for Claude Code working in this repo
```

## Tests

```bash
node game-night-tests/logic.test.js           # pure game logic (no browser)
node game-night-tests/smoke.js                # a bot plays every game through the real UI in headless Chromium
node game-night-server/server.test.js         # relay server
node game-night-tests/online.test.js          # 2–4 real game clients playing each other through the server (bots, drops, reloads)
node game-night-tests/mobile.test.js          # phone emulation: real touch taps at 360px, overflow/tap-size audit, PWA + offline
```

The browser tests need Chromium (`CHROME=/path/to/chrome` if it isn't on your `PATH`).

## Adding a game

1. Write `class MyGame extends Game` with a `static meta = { id, name, emoji, tag, min, max, c1, c2, rules, opts? }` and a `start()`.
2. Build your DOM in `this.root`; read `this.players` (`{name, cpu}`), `this.level`, `this.opts`.
3. Call `this.turn(i, 'text')` each turn and `this.finish(title, sub, { winner: i })` at the end.
4. Add the class to the `GAMES` array.

Optional: `serialize()` enables save/resume. For online play, route every human input through `this.ui(kind, ...args)` and
implement `doInput(kind, ...args)` — see [`CLAUDE.md`](CLAUDE.md) for the rules that keep clients in sync.

## Ideas for next

Dots and Boxes · Backgammon · Battleship · Memory Match · Dominoes / Reversi · move history · stats & streaks · server-side hidden cards

## Deploy (Render)

The repo includes `render.yaml`. On [render.com](https://render.com): **New + → Blueprint → pick this repo → Apply**.
Render gives you an `https://….onrender.com` address (HTTPS, so voice chat and "install app" work). Share that address or the invite link.
The free plan sleeps after ~15 minutes without traffic and forgets rooms when it restarts.
