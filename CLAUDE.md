# CLAUDE.md — Game Night

A single-file browser game hub (`game-night.html`: CSS + JS, no dependencies) plus a zero-dependency Node relay server
for online play. Keep it that way: **no libraries, no external images, no build step.** Emoji, CSS and inline SVG only.

## Layout

- `game-night.html` — the app. Sections (search for the banner comments): 1 Helpers → 2 UI → 3 Dice/Game base →
  4a–4f games → 5a Net → 5 Hub → 6 Boot. One class per game; new games are added to the `GAMES` array.
- `game-night-server/server.js` — static server + WebSocket relay (hand-written RFC 6455, no `ws` package). No game logic.
- `game-night-tests/` — see Commands.

## Commands

```bash
node game-night-tests/logic.test.js      # pure logic, instant
node game-night-tests/smoke.js           # bot plays every game via the DOM in headless Chromium (~15 s)
node game-night-server/server.test.js    # relay server
node game-night-tests/online.test.js     # real server + 2–4 game iframes playing each other, incl. bots/drops/reloads (~6 min; prints only at the end)
node game-night-tests/mobile.test.js     # CDP phone emulation: real touch, 360px overflow + tap-size audit, PWA/offline (~30 s)
node game-night-server/server.js         # run it (PORT=9000 to change); serves the game at /
```

Run all four after any change to game logic, the Hub, or online code. Syntax-check quickly by extracting the script and
running `node --check`. Don't assume a change works because it parses — the bot tests have caught real bugs that looked fine.

## Conventions

- **Every game extends `Game`** (`static meta`, `start()`, `serialize()` optional, `doInput()` for online). Use
  `this.turn()`, `this.finish(title, sub, {winner})`, `this.tools([...])`, `this.run(fn)`.
- **Async flows use `await this.wait(ms)`**, never bare `setTimeout`/`sleep` — `wait` throws the `DEAD` sentinel when the
  game is closed. Start async flows with `this.run(...)` so `DEAD` is swallowed.
- **DOM building uses `h(tag, props, ...kids)`.** Pitfall (hit three times): `el.replaceChildren(...)` does NOT flatten arrays or
  skip `null` — spread arrays (`...list`) and never pass `cond ? node : null` directly (it renders the text "null").
  Inside `h()` children are flattened and null-safe.
- **Randomness:** `rand()`/`shuffle()` are *game-logic* randomness (seeded identically on every client online).
  Use `crand()` / `Math.random()` for anything cosmetic (animation frames, confetti, background). Mixing them desyncs online games.
- Comment code sections clearly; keep the single-file structure. Mobile-first: must work from 360 px wide.
- localStorage access must stay inside try/catch (`Store`).

## Online play — rules that keep clients in sync

Model: every client runs the *whole* game from the same seed; human inputs go to the server, which echoes them to
everyone in one order; every client applies them (`Hub.pumpInputs` → `game.doInput`). So:

1. Route every human input through `this.ui(kind, ...args)`; implement `doInput(kind, ...args)`. Offline `ui` calls `doInput` directly.
2. `doInput` returns **`false` if the game isn't ready** for it yet (it is retried), **`true` when consumed**. Be idempotent about
   readiness (e.g. `if (!this.dice.onClick) return false`). Set `this.busy = true` synchronously before launching async work.
3. Only `this.cur` may act online (`isMine(this.cur)`); show hints/highlights only for the local player.
4. No hidden-from-others state in the render path; no clock- or `Math.random()`-dependent game logic.
5. Anything mutated on "Play Again" (e.g. Crazy Eights `carry`) must change **deterministically at game end on every client**, not
   inside the button's `onAgain` (only one client presses it).
6. Online disables undo and save/resume (`this.net` is set).
7. **Bots online** are just `players[i].cpu === true` appended after the humans (host picks the count). They run on *every* client, so
   their decisions must only use `rand()`/game state (seeded) — never `crand`/`Math.random`/timing.
8. **Reconnect = replay.** The server logs `start`/`again`/`in` messages; a rejoining client rebuilds the game by re-applying them in
   `FF` (fast-forward) mode: `sleep()` is instant, sound/toasts are off, `Game.finish` defers the winner screen. So game flows must
   use `this.wait()`/`sleep()` for all delays (never raw `setTimeout` for *game logic*) and must be deterministic from the inputs alone.

9. **Chat** (reactions + voice clips) is a separate `{t:'chat'}` channel, *not* `{t:'msg'}`: the server validates, rate-limits and relays it without logging, so it never
   affects game order or replay. Never route game state through it.

## Testing notes

- `?speed=25` on the page URL divides all waits by 25 (used by tests). The online test serves its page via `GN_TEST_PAGE`.
- Snap Chromium can't read dot-directories or `/tmp`: temp files for browser tests go in `game-night/tmp/` (non-hidden, inside the project; auto-cleaned).
- The online test compares `JSON.stringify(game.serialize())` across clients — a new game should implement `serialize()` so it is covered.
- `window.hub` is exposed on purpose (tests/debugging). `?sid=` namespaces the saved online session (tests run several "phones" in one tab).
- `online.test.js` reports only when everything finishes; run it in the background. `mobile.test.js` needs Node 22+ (global WebSocket) and Chromium;
  `SHOTS=/dir node game-night-tests/mobile.test.js` saves screenshots.
- PWA: `server.js` serves `/manifest.webmanifest`, `/sw.js` (network-first, cache fallback) and `assets/icon-*.png`. The page registers the worker only when
  served over http(s) and `SPEED === 1`. Bump `V` in the SW string in `server.js` if the cache strategy changes.

## Gotchas / decisions

- Ludo: `pos` −1 base · 0–50 main track · 51–55 home column · 56 centre; global square = `(LD_ST[colour] + pos) % 52`.
  Opponent blocks (2+ same-colour tokens) can't be landed on or jumped over (toggle `blocks`).
- Checkers moves are `{from, path[], caps[]}` with `caps[k]` removed when landing on `path[k]`; jump promotion ends the move.
- Snakes & Ladders boards come from `slGenerate()` (10 snakes, 9 ladders, no crossings, no shared squares); falls back to the classic board.
- Crazy Eights: 8s wild; draw-until-playable; action cards optional (`opts.actions`); "LAST CARD" must be called at 2 cards or draw 2.
- Never publish/host with `GN_TEST_PAGE` set — it adds test-only routes.
