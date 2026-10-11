// Capturas del launcher y del asistente (ES/EN) con un acHost simulado.
// Uso: node tools/screenshots.mjs <carpeta de salida>   (necesita playwright; en Windows usa Bahnschrift)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require(path.join(process.env.PW_GLOBAL || '', 'playwright')); }

const here = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(here, '..', 'launcher', 'ui');
const OUT = path.resolve(process.argv[2] || path.join(here, '..', 'docs', 'screenshots'));
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(UI, u === '/' ? 'index.html' : u);
  if (!f.startsWith(UI) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port + '/index.html';

const now = Date.now();
const state = (ui, extra) => Object.assign({
  config: { ui, playtime: 151 * 3600 + 22 * 60, lastPlayed: now - 3600e3 * 20, input: 'pad', pname: 'Akira' },
  fullscreen: false, suyuOk: true, keysOk: true, gameOk: true, engine: 'suyu Dynarmic JIT', fpsModOk: true,
  achievements: { unlocked: { file01: now, file02: now, file03: now, file04: now, file05: now, file06: now, file07: now } }, shots: [],
  needsSetup: false, suyuBundled: true, personal: { hero: false, music: false }, baseAtlas: false
}, extra || {});

const browser = await pw.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => {
  window.acHost = { postMessage: (s) => { (window.__sent = window.__sent || []).push(JSON.parse(s)); }, addEventListener: () => {} };
});
const msg = (type, data) => page.evaluate(([t, d]) => window.__acMsg({ data: JSON.stringify({ type: t, data: d }) }), [type, data]);
const settle = (ms = 700) => page.waitForTimeout(ms);
const shot = async (name) => { await settle(); await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('ok', name); };
const fresh = async () => { await page.goto(base); await page.evaluate(() => { document.getElementById('boot').style.display = 'none'; document.body.classList.add('noanim'); }); };
const click = (sel) => page.click(sel, { force: true });

const files = { prodKeys: 'D:\\Switch\\dump\\prod.keys', firmware: 'D:\\Switch\\dump\\Firmware 19.0.1.zip', base: 'D:\\Switch\\dump\\ASTRAL CHAIN [01007300020FA000][v0].nsp', update: 'D:\\Switch\\dump\\ASTRAL CHAIN [01007300020FA800][v65536].nsp' };
const logLines = ['[  2.104] Loader <Info> Base: ASTRAL CHAIN v1.0.0', '[  2.388] Loader <Info> Update: v65536 (1.0.1)', '[  3.017] Content <Info> Verifying program NCA…', '[ 14.902] Content <Info> RomFS: 11.2 GiB (patched by update)', '[ 15.311] Content <Info> Writing romfs.bin …'];

const wiz = async (ui) => { await fresh(); await msg('state', state(ui, { needsSetup: true, suyuOk: false, gameOk: false })); };
const agree = async () => { for (const c of [0, 1, 2]) await click('#setup .chk[data-c="' + c + '"]'); await click('#sNext'); };
const pickAll = async () => { for (const [what, file] of Object.entries(files)) await msg('setupPicked', { what, file }); };

// 01-02 son del instalador (tools/installer_shots.ps1)
await wiz('es'); await click('#setup .chk[data-c="0"]'); await shot('03_wizard_legal_es');
await wiz('en'); await agree(); await pickAll(); await shot('04_wizard_files_en');
await wiz('es'); await agree(); await pickAll(); await click('#sNext');
for (const [i, l] of logLines.entries()) await msg('setupProgress', { step: 'dump', pct: 20 + i * 9, msg: l });
await shot('05_wizard_export_es');
await wiz('en'); await agree(); await click('#sAlt'); await shot('06_wizard_manual_en');
await fresh(); await msg('state', state('es')); await shot('07_home_es');
await fresh(); await msg('state', state('en')); await shot('08_home_en');
await fresh(); await msg('state', state('es')); await click('.mi[data-go="settings"]'); await page.evaluate(() => [...document.querySelectorAll('.tab')][0].click()); await shot('09_settings_es');
await fresh(); await msg('state', state('en')); await click('.mi[data-go="settings"]'); await page.evaluate(() => [...document.querySelectorAll('.tab')][2].click()); await shot('10_controls_en');

await browser.close(); srv.close();
