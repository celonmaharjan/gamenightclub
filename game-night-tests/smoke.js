// Browser smoke test: a "human bot" clicks through every game in headless Chromium (virtual time = fast).
// Run: node smoke.js        (needs chromium: set CHROME=/path/to/chrome if not auto-found)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process'), os = require('os');
const src = fs.readFileSync(path.join(__dirname, '..', 'game-night.html'), 'utf8').replace('function boot() { new Hub(', 'function boot() { window.hub=new Hub(');
const driver = fs.readFileSync(process.env.DRIVER || path.join(__dirname, 'smoke-driver.js'), 'utf8');
const page = src.replace('</body>', `<pre id="out"></pre><script>(function(){${driver}})()</script></body>`);
const TMP = () => { const t = path.join(__dirname, '..', 'tmp'); fs.mkdirSync(t, { recursive: true }); return t; };
const dir = fs.mkdtempSync(path.join(TMP(), 'smoke-')); const file = path.join(dir, 'smoke.html'); fs.writeFileSync(file, page);
const chrome = process.env.CHROME || ['chromium-browser', 'chromium', 'google-chrome'].find(c => { try { execFileSync('which', [c]); return true; } catch (e) { return false; } });
try {
  const out = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=2000000000', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 280000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
  const log = (out.match(/<pre id="out">([\s\S]*?)<\/pre>/) || [, ''])[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  if (!log) console.log('No output from browser (page failed to load?)'); console.log(log); process.exitCode = /FAIL|ERROR|REJECT/.test(log) || !/ALL DONE/.test(log) ? 1 : 0;
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
