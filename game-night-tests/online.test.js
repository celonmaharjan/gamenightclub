// Online end-to-end test: real server + several game clients (iframes) in headless Chromium, playing each other through the relay.
// Run: node online.test.js     (needs chromium; set CHROME=/path if not auto-found)
const { spawn, execFileSync } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = 19000 + Math.floor(Math.random() * 900), home = path.join(__dirname, '..', 'tmp');
fs.mkdirSync(home, { recursive: true });
const prof = fs.mkdtempSync(path.join(home, 'prof-'));             // non-hidden dir (snap Chromium can't use dot-dirs)
const chrome = process.env.CHROME || ['chromium-browser', 'chromium', 'google-chrome'].find(c => { try { execFileSync('which', [c]); return true; } catch (e) { return false; } });
const srv = spawn('node', [path.join(__dirname, '..', 'game-night-server', 'server.js')], { env: { ...process.env, PORT, GN_TEST_PAGE: path.join(__dirname, 'online-driver.html'), GN_EXIT_ON_REPORT: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = ''; srv.stdout.on('data', d => { out += d; });
let br; const finish = code => { try { br && br.kill(); srv.kill(); } catch (e) { /* ignore */ } try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* ignore */ } process.exit(code); };
setTimeout(() => {
  br = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--user-data-dir=' + prof, '--window-size=1600,900', `http://localhost:${PORT}/test` + (process.env.ONLY ? '?only=' + encodeURIComponent(process.env.ONLY) : '')], { stdio: 'ignore' });
}, 800);
srv.on('exit', () => { const rep = (out.match(/REPORT\n([\s\S]*)/) || [, ''])[1]; console.log(rep || 'No report received.\n' + out); finish(/FAIL|ERROR|REJECT/.test(rep) || !/ALL DONE/.test(rep) ? 1 : 0); });
setTimeout(() => { console.log('TIMEOUT\n' + out); finish(1); }, 900000);
