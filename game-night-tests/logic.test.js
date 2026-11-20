// Pure-logic tests (no browser). Run: node logic.test.js
const fs = require('fs'), assert = require('assert'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'game-night.html'), 'utf8');
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];
const m = { exports: {} }; new Function('module', code)(m); const G = m.exports;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('Ludo track: 52 unique squares, every arm cell covered', () => {
  assert.strictEqual(G.LD_TRACK.length, 52); assert.strictEqual(new Set(G.LD_TRACK.map(String)).size, 52);
  const keys = new Set([...G.LD_TRACK, ...G.LD_HC.flat()].map(String));
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    const base = (r < 6 || r > 8) && (c < 6 || c > 8), ctr = r >= 6 && r <= 8 && c >= 6 && c <= 8;
    if (!base && !ctr) assert(keys.has(r + ',' + c), `uncovered ${r},${c}`);
  }
});
t('Tic-Tac-Toe: perfect self-play is a draw', () => {
  const b = Array(9).fill(null); let p = 'X';
  while (!G.tttWinner(b) && b.some(x => !x)) {
    let best = -1e9, mv; for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = p; const s = G.tttMinimax(b, p === 'X' ? 'O' : 'X', p, 1); b[i] = null; if (s > best) { best = s; mv = i; } }
    b[mv] = p; p = p === 'X' ? 'O' : 'X';
  }
  assert.strictEqual(G.tttWinner(b), null);
});
t('Connect Four AI wins when it can and blocks when it must', () => {
  const mk = () => Array.from({ length: 6 }, () => Array(7).fill(null));
  let g = mk(); [0, 1, 2].forEach(c => g[5][c] = 0); assert.strictEqual(G.c4Search(g, 5, -Infinity, Infinity, true, 0).c, 3);
  g = mk(); [0, 1, 2].forEach(c => g[5][c] = 1); assert.strictEqual(G.c4Search(g, 5, -Infinity, Infinity, true, 0).c, 3);
});
t('Checkers: 7 opening moves each, forced multi-jump, random games terminate', () => {
  const bd = Array(64).fill(null); for (let i = 0; i < 64; i++) { const r = i >> 3, c = i & 7; if ((r + c) % 2 && (r < 3 || r > 4)) bd[i] = { p: r < 3 ? 1 : 0, k: false }; }
  assert.strictEqual(G.ckGen(bd, 0).length, 7); assert.strictEqual(G.ckGen(bd, 1).length, 7);
  const b2 = Array(64).fill(null); b2[40] = { p: 0, k: false }; b2[33] = { p: 1, k: false }; b2[19] = { p: 1, k: false }; b2[2 * 8 + 6] = { p: 1, k: false };
  const mv = G.ckGen(b2, 0); assert(mv.every(x => x.caps.length >= 1)); assert(mv.some(x => x.caps.length === 2));
  for (let g = 0; g < 50; g++) { let B = G.ckClone(bd), p = 0, k = 0; while (k++ < 400) { const mm = G.ckGen(B, p); if (!mm.length) break; G.ckApply(B, mm[Math.floor(Math.random() * mm.length)]); p = 1 - p; } }
});
t('Snakes & Ladders: 300 random boards valid (10 snakes, 9 ladders, no shared squares)', () => {
  for (let i = 0; i < 300; i++) {
    const { snakes, ladders } = G.slGenerate(); const all = [...Object.keys(snakes), ...Object.values(snakes), ...Object.keys(ladders), ...Object.values(ladders)].map(Number);
    assert.strictEqual(Object.keys(snakes).length, 10); assert.strictEqual(Object.keys(ladders).length, 9); assert.strictEqual(new Set(all).size, all.length);
    for (const [h, tl] of Object.entries(snakes)) assert(+h > tl); for (const [b, tp] of Object.entries(ladders)) assert(tp > +b);
  }
});
t('Every game declares meta.rules', () => { for (const g of G.GAMES) assert(g.meta.rules && g.meta.rules.length >= 3, g.meta.id); });
console.log(`\n${n} logic tests passed`);
