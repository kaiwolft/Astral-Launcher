// Asistente de primera vez: arma la carpeta del juego ("ASTRAL CHAIN - Dynarmic JIT") a partir de los archivos
// del propio usuario (claves, firmware, .nsp/.xci base y actualizacion 1.0.1). El launcher no trae nada de eso.
//
// Pasos:
//   1. claves -> suyu\user\keys (suyu portatil incluido) y juego\user\keys
//   2. suyu-cmd --content-base <base> --content-update <update> --content-probe --content-dump <tmp>
//      (suyu resuelve el juego con su actualizacion: romfs.bin + ejecutables)
//   3. se ordena el resultado como el export "Dynarmic JIT" de suyu: exefs\main, sdk, rtld, main.npdm, romfs.bin
//   4. motor: suyu-cmd.exe (+ DLL) como "Astral Chain.exe"; firmware -> user\nand\system\Contents\registered
//   5. parches (60 FPS y cinematicas) -> mods_desactivado (el launcher los activa segun Ajustes)
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const TITLE_ID = '01007300020FA000';
const EXE_NAME = 'Astral Chain.exe';
const RUNTIME_DLLS = ['libcrypto.dll', 'libssl.dll', 'dxcompiler.dll', 'dxil.dll'];
const EXEFS_FILES = ['main', 'main.npdm', 'rtld', 'sdk'];

const exists = (f) => { try { return fs.existsSync(f); } catch (e) { return false; } };

// busca archivos por nombre dentro de una carpeta (recursivo)
function findFiles(dir, names, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, names, out);
    else if (names.includes(e.name.toLowerCase()) && !out[e.name.toLowerCase()]) out[e.name.toLowerCase()] = p;
  }
  return out;
}
function freeBytes(dir) { try { const st = fs.statfsSync(dir); return st.bavail * st.bsize; } catch (e) { return 0; } }
function listTree(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listTree(p, base, out); else out.push(path.relative(base, p) + '  ' + fs.statSync(p).size);
  }
  return out;
}
function copyDir(src, dst) { fs.mkdirSync(dst, { recursive: true }); fs.cpSync(src, dst, { recursive: true }); }

// firmware: carpeta con .nca o .zip (se descomprime con PowerShell)
function expandZip(zip, dst) {
  return new Promise((res, rej) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath ' + JSON.stringify(zip).replace(/"/g, "'") + ' -DestinationPath ' + JSON.stringify(dst).replace(/"/g, "'") + ' -Force'],
    { windowsHide: true }, (err) => (err ? rej(err) : res()));
  });
}

function run(exe, args, cwd, onLine) {
  return new Promise((res) => {
    const p = spawn(exe, args, { cwd, windowsHide: true });
    let buf = '';
    const feed = (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); } };
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('error', (e) => { onLine('ERROR: ' + e.message); res(-1); });
    p.on('exit', (code) => res(code));
  });
}

// opts: { keysDir|prodKeys, titleKeys, firmware, base, update, suyuDir, gameDir, modsSrc, profilesSrc }
// cb(step, pct, msg)
async function exportGame(opts, cb) {
  const say = (step, pct, msg) => { try { cb(step, pct, msg); } catch (e) {} };
  const { suyuDir, gameDir } = opts;
  const suyuCmd = path.join(suyuDir, 'suyu-cmd.exe');
  if (!exists(suyuCmd)) throw new Error('No encuentro suyu-cmd.exe en ' + suyuDir);
  for (const [k, v] of [['prodKeys', opts.prodKeys], ['base', opts.base], ['update', opts.update]]) if (!v || !exists(v)) throw new Error('Falta el archivo: ' + k);
  if (exists(path.join(gameDir, 'exefs', 'romfs.bin'))) throw new Error('Ya existe una carpeta del juego en ' + gameDir);

  // 1. claves para suyu (portatil: carpeta user junto al exe)
  say('keys', 3, 'keys');
  const sk = path.join(suyuDir, 'user', 'keys');
  fs.mkdirSync(sk, { recursive: true });
  fs.copyFileSync(opts.prodKeys, path.join(sk, 'prod.keys'));
  if (opts.titleKeys && exists(opts.titleKeys)) fs.copyFileSync(opts.titleKeys, path.join(sk, 'title.keys'));

  // 2. resolver el juego con su actualizacion. suyu-cmd no escribe nada en pantalla mientras trabaja (unos 2-3 min),
  //    asi que el progreso se calcula con lo que va escribiendo (romfs.bin.partial / espacio libre del disco).
  const tmp = path.join(path.dirname(gameDir), '_exportando_' + Date.now());
  say('dump', 8, 'dump');
  const lines = [];
  const TOTAL = 10310254332;                       // romfs_bytes de ASTRAL CHAIN 1.0.1 (lo confirma el log de suyu)
  const free0 = freeBytes(path.dirname(gameDir));
  let last = 0, lastChange = Date.now(), stalled = false;
  const tick = setInterval(() => {
    let done = 0;
    try { done = fs.statSync(path.join(tmp, 'exefs', 'romfs.bin.partial')).size; } catch (e) {}
    try { done = Math.max(done, fs.statSync(path.join(tmp, 'exefs', 'romfs.bin')).size); } catch (e) {}
    const f = freeBytes(path.dirname(gameDir));
    if (free0 && f) done = Math.max(done, free0 - f);
    if (done > last + (8 << 20)) { last = done; lastChange = Date.now(); }
    else if (Date.now() - lastChange > 6 * 60e3) stalled = true;
    const pct = 10 + Math.min(70, Math.round(last / TOTAL * 70));
    say('dump', pct, (last / 1073741824).toFixed(1) + ' / ' + (TOTAL / 1073741824).toFixed(1) + ' GB');
  }, 1500);
  let code;
  try {
    code = await run(suyuCmd, ['--content-base', opts.base, '--content-update', opts.update, '--content-probe', '--content-dump', tmp], suyuDir, (l) => { lines.push(l); say('dump', null, l); });
  } finally { clearInterval(tick); }
  // el log de suyu dice que paso (suyu-cmd no usa la consola)
  try { for (const l of fs.readFileSync(path.join(suyuDir, 'user', 'log', 'suyu_log.txt'), 'utf8').split(/\r?\n/)) if (l.trim()) lines.push(l.trim()); } catch (e) {}
  if (!exists(path.join(tmp, 'verified-data.complete'))) {
    const why = lines.filter((l) => /<(Error|Critical)>|Failed|missing|invalid/i.test(l)).slice(-3).join(' | ') || lines.slice(-3).join(' | ');
    throw new Error('suyu no termino de exportar el juego (codigo ' + code + (stalled ? ', sin avance por 6 min' : '') + '). ' + why);
  }

  // 3. ordenar como el export JIT
  say('arrange', 82, 'arrange');
  const found = findFiles(tmp, ['romfs.bin', ...EXEFS_FILES, 'control.nca']);
  if (!found['romfs.bin'] || !found.main || !found['main.npdm']) throw new Error('El resultado de suyu no tiene lo esperado: ' + listTree(tmp).slice(0, 20).join(' ; '));
  const ex = path.join(gameDir, 'exefs');
  fs.mkdirSync(ex, { recursive: true });
  for (const n of [...EXEFS_FILES, 'control.nca', 'romfs.bin']) if (found[n]) fs.renameSync(found[n], path.join(ex, n));
  if (exists(path.join(ex, 'control.nca'))) fs.writeFileSync(path.join(gameDir, 'aot_manifest.json'), JSON.stringify({ control_metadata: 'exefs/control.nca' }, null, 4));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}

  // 4. motor y datos del usuario
  say('runtime', 88, 'runtime');
  fs.copyFileSync(suyuCmd, path.join(gameDir, EXE_NAME));
  for (const d of RUNTIME_DLLS) if (exists(path.join(suyuDir, d))) fs.copyFileSync(path.join(suyuDir, d), path.join(gameDir, d));
  fs.writeFileSync(path.join(gameDir, 'discord.ini'), 'enabled=0\r\ncover_url=\r\n');
  const user = path.join(gameDir, 'user');
  copyDir(sk, path.join(user, 'keys'));
  fs.mkdirSync(path.join(user, 'config'), { recursive: true });
  fs.writeFileSync(path.join(user, 'config', 'suyu-install.txt'), path.join(gameDir, EXE_NAME) + '\r\n');

  if (opts.firmware && exists(opts.firmware)) {
    say('firmware', 91, 'firmware');
    let src = opts.firmware;
    if (/\.zip$/i.test(src)) { const t2 = path.join(path.dirname(gameDir), '_firmware_' + Date.now()); await expandZip(src, t2); src = t2; }
    const reg = path.join(user, 'nand', 'system', 'Contents', 'registered');
    fs.mkdirSync(reg, { recursive: true });
    let n = 0;
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.nca$/i.test(e.name)) { fs.copyFileSync(p, path.join(reg, e.name)); n++; } } };
    walk(src);
    if (src !== opts.firmware) try { fs.rmSync(src, { recursive: true, force: true }); } catch (e) {}
    say('firmware', 95, n + ' NCA');
  }

  // 5. parches incluidos con el launcher (apagados hasta que el launcher los active)
  say('mods', 97, 'mods');
  const msrc = path.join(opts.modsSrc || '', TITLE_ID);
  if (opts.modsSrc && exists(msrc)) copyDir(msrc, path.join(gameDir, 'mods_desactivado', TITLE_ID));
  fs.mkdirSync(path.join(gameDir, 'mods', TITLE_ID), { recursive: true });

  say('done', 100, 'ok');
  return { gameDir, exe: path.join(gameDir, EXE_NAME), log: lines };
}

module.exports = { exportGame, EXE_NAME };
