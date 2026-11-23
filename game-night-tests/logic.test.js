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
t('Dots & Boxes: geometry, box completion, AI takes free boxes and avoids 3rd sides', () => {
  const d = G.dbDims(4, 4); assert.strictEqual(d.N, 40); assert.strictEqual(d.HN, 20);
  for (let id = 0; id < d.N; id++) { const bs = G.dbLineBoxes(d, id); assert(bs.length >= 1 && bs.length <= 2); }
  const L = Array(d.N).fill(0); [0, 4, 20].forEach(x => L[x] = 1);                // box (0,0) has 3 sides: top, bottom, left
  assert.strictEqual(G.dbSides(d, L, 0, 0), 3); const r = n => 0;
  assert.strictEqual(G.dbPick(d, L, 'medium', r), 21); assert.strictEqual(G.dbPick(d, L, 'hard', r), 21);
  const L2 = Array(d.N).fill(0); L2[0] = 1; L2[20] = 1;                            // box (0,0) has 2 sides: AI must not add a 3rd
  for (const lv of ['medium', 'hard']) { const mv = G.dbPick(d, L2, lv, n => Math.floor(Math.random() * n)); assert(![4, 21].includes(mv), lv + ' gave a box away: ' + mv); }
});
t('Computer difficulty: Hard beats Easy (Connect Four, Dots & Boxes)', () => {
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const c4 = () => { const w = [0, 0]; for (let gm = 0; gm < 20; gm++) { const g = Array.from({ length: 6 }, () => Array(7).fill(null)); let p = gm % 2, res = null;
    for (let k = 0; k < 42 && res == null; k++) { const valid = [0, 1, 2, 3, 4, 5, 6].filter(c => g[0][c] == null); if (!valid.length) break;
      const c = p === 0 ? G.c4Search(g, 5, -Infinity, Infinity, true, 0).c : rnd(100) < 40 ? valid[rnd(valid.length)] : G.c4Search(g, 2, -Infinity, Infinity, true, 1).c;
      g[G.c4Row(g, c)][c] = p; if (G.c4Find(g)) res = p; p = 1 - p; }
    if (res != null) w[res]++; } return w; };
  const cw = c4(); assert(cw[0] >= 15 && cw[0] > cw[1] * 3, 'C4 hard vs easy ' + cw);
  const dw = [0, 0]; for (let gm = 0; gm < 30; gm++) { const d = G.dbDims(4, 4), L = Array(d.N).fill(0), sc = [0, 0]; let p = gm % 2;
    for (let k = 0; k < d.N; k++) { const id = G.dbPick(d, L, p === 0 ? 'hard' : 'easy', rnd); L[id] = 1; let got = 0; for (const [r, c] of G.dbLineBoxes(d, id)) if (G.dbSides(d, L, r, c) === 4) got++; sc[p] += got; if (!got) p = 1 - p; }
    if (sc[0] !== sc[1]) dw[sc[0] > sc[1] ? 0 : 1]++; }
  assert(dw[0] > dw[1] * 2, 'Dots hard vs easy ' + dw);
  console.log(`   (Connect Four hard-easy ${cw[0]}-${cw[1]}, Dots & Boxes hard-easy ${dw[0]}-${dw[1]})`);
});
t('Every game declares meta.rules', () => { for (const g of G.GAMES) assert(g.meta.rules && g.meta.rules.length >= 3, g.meta.id); });
console.log(`\n${n} logic tests passed`);
