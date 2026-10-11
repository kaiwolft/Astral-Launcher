// Astral Chain — Dionixu's Launcher (Electron / Chromium) · Windows
// Lanza la version "Dynarmic JIT" del juego (suyu-cmd), aplica ajustes, menu de pausa con Esc / L3+R3,
// volumen en vivo, galeria de capturas y avisos de logro. Incluye un asistente de primera vez que arma el
// juego a partir de los archivos del propio usuario (el launcher no incluye juego, claves ni firmware).
const { app, BrowserWindow, ipcMain, screen, protocol, net, session, shell, dialog } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const APP_NAME = "Astral Chain — Dionixu's Launcher";
const ROOT = path.dirname(process.execPath);          // carpeta launcher
const UI = path.join(ROOT, 'ui');
const DATA = path.join(ROOT, 'data');
const CFG = path.join(DATA, 'config.json');
const PATHS = path.join(DATA, 'paths.json');
const ACH = path.join(DATA, 'logros.json');
const LOG = path.join(DATA, 'launcher.log');
const TITLE_ID = '01007300020FA000';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{ scheme: 'ac', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.setPath('userData', path.join(DATA, 'chromium'));
app.setName("Dionixu's Launcher");

const log = (s) => { try { fs.appendFileSync(LOG, new Date().toISOString() + '  ' + s + '\n'); } catch (e) {} };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (e) { return d; } };
const exists = (f) => { try { return fs.existsSync(f); } catch (e) { return false; } };
const saveCfg = () => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CFG, JSON.stringify(cfg, null, 1)); } catch (e) {} };

const DEFAULTS = {
  res: '2', wsize: '1600', fps: '60', vsync: 'on', filter: 'bilinear', aa: 'off', accuracy: 'normal', mode: 'full',
  input: 'pad', msens: 50, minvert: 'off', ui: 'es', lang: 'es419', gvol: '100', music: 'on', mvol: 35, sfx: 'on', achToast: 'on', anim: 'on', launcherFull: 'on', btnIcons: 'custom', gfxCompat: 'on', cut30: 'on', astcAsync: 'on'
};
let cfg = Object.assign({}, DEFAULTS, readJson(CFG, {}));
// las cinematicas necesitan el arreglo de velocidad con 60 FPS (sin el van al doble): se activa una vez
if (!cfg.cut30fix) { cfg.cut30 = 'on'; cfg.cut30fix = 1; }
let launchFull = false;
const WSIZE = (w) => ({ '1280': [1280, 720], '1600': [1600, 900], '1920': [1920, 1080] }[w] || [1600, 900]);
let win = null, game = null, exitWin = null, toastWin = null, bridge = null, exitOpen = false, gameStart = 0, gameSeen = false;

// ---------------- rutas (relativas a la carpeta del launcher; se pueden cambiar en data/paths.json)
// Base del juego: la version "Dynarmic JIT" exportada desde suyu (suyu-cmd sin interfaz + exefs + romfs.bin).
// Todo vive dentro de su carpeta: configuracion, partidas, mods, shaders, claves y firmware.
const paths = (() => {
  const raw = readJson(PATHS, {});
  const dir = path.resolve(ROOT, raw.engineDir || '../ASTRAL CHAIN - Dynarmic JIT');
  const user = path.join(dir, 'user');
  return {
    dir, user,
    ini: path.join(user, 'config', 'sdl2-config.ini'),
    load: path.join(dir, 'mods', TITLE_ID),
    loadOff: path.join(dir, 'mods_desactivado', TITLE_ID),
    shots: path.join(user, 'screenshots'),
    saves: path.join(user, 'nand', 'user', 'save'),
    log: path.join(user, 'log', 'suyu_log.txt'),
    suyu: path.resolve(ROOT, raw.suyuDir || '../suyu'),          // suyu incluido (exportar / modo manual)
    modsSrc: path.resolve(ROOT, raw.modsDir || '../mods'),       // parches incluidos con el launcher
    personal: path.join(DATA, 'personal')                         // imagen y musica propias del usuario
  };
})();
const BASE_ATLAS = path.join(DATA, 'base_atlas.rgba');
// el .exe del juego (su nombre lo pone el exportador)
function engineExe() {
  try {
    const f = fs.readdirSync(paths.dir).find((n) => /\.exe$/i.test(n) && !/crash|unins|update/i.test(n));
    return f ? path.join(paths.dir, f) : null;
  } catch (e) { return null; }
}
// carpeta de claves que usa el export: <instalacion de suyu indicada en suyu-install.txt>\user\keys
function keysDir() {
  try {
    const p = fs.readFileSync(path.join(paths.user, 'config', 'suyu-install.txt'), 'utf8').trim();
    if (p) return path.join(path.dirname(p), 'user', 'keys');
  } catch (e) {}
  return path.join(paths.user, 'keys');
}
// Carpeta portatil: el juego guarda rutas absolutas (claves en suyu-install.txt y carpetas en sdl2-config.ini).
// Se reescriben con la ubicacion actual en cada arranque, asi "Astral Chain PC" se puede mover a donde sea.
function fixPortablePaths() {
  const exe = engineExe();
  if (!exe) return;
  try {
    const inst = path.join(paths.user, 'config', 'suyu-install.txt');
    const cur = exists(inst) ? fs.readFileSync(inst, 'utf8').trim() : '';
    if (cur !== exe) { fs.mkdirSync(path.dirname(inst), { recursive: true }); fs.writeFileSync(inst, exe + '\r\n'); log('rutas: suyu-install.txt -> ' + exe); }
  } catch (e) { log('suyu-install.txt: ' + e.message); }
  if (!exists(paths.ini)) return;
  const f = (p) => p.replace(/\\/g, '/');
  try {
    setQt({ 'Data%20Storage': {
      nand_directory: f(path.join(paths.user, 'nand')), sdmc_directory: f(path.join(paths.user, 'sdmc')),
      load_directory: f(path.join(paths.dir, 'mods')), dump_directory: f(path.join(paths.user, 'dump')), tas_directory: f(path.join(paths.user, 'tas'))
    } });
  } catch (e) { log('rutas del juego: ' + e.message); }
}
const engineName = () => { const e = engineExe(); return e ? path.basename(e, '.exe').replace(/^ASTRAL CHAIN\s*-\s*/i, '') : 'JIT'; };

// Nombre del usuario de la "consola" (profiles.dat). La version exportada no tiene teclado en pantalla:
// el juego toma este nombre como texto inicial del campo de nombre y la version JIT lo acepta tal cual.
// Formato: 0x10 de cabecera + 8 usuarios de 0xC8 bytes (uuid 16, uuid 16, fecha 8, nombre 32 en UTF-8, extra 0x80).
function writeProfileName(name) {
  name = String(name || '').trim();
  if (!name) return;
  const f = path.join(paths.user, 'nand', 'system', 'save', '8000000000000010', 'su', 'avators', 'profiles.dat');
  try {
    const b = fs.readFileSync(f);
    let enc = Buffer.from(name, 'utf8');
    while (enc.length > 31) { name = [...name].slice(0, -1).join(''); enc = Buffer.from(name, 'utf8'); }
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const o = 0x10 + i * 0xC8;
      if (o + 0xC8 > b.length) break;
      if (b.subarray(o, o + 16).every((x) => x === 0)) continue;   // hueco vacio
      b.fill(0, o + 40, o + 72); enc.copy(b, o + 40); n++;
    }
    if (n) { fs.writeFileSync(f, b); log('nombre del oficial: ' + name); }
  } catch (e) { log('nombre del oficial: ' + e.message); }
}

// Cache de shaders: se aparta (no se borra) para que se vuelvan a compilar desde cero.
// La primera vez que se usa la version JIT se hace solo, porque la cache vino copiada de suyu.
function resetShaderCache(why) {
  const dir = path.join(paths.user, 'cache', 'shader');
  if (!exists(dir)) return false;
  const bk = path.join(DATA, 'shaders_apartados', new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19));
  try {
    fs.mkdirSync(path.dirname(bk), { recursive: true });
    fs.cpSync(dir, bk, { recursive: true }); fs.rmSync(dir, { recursive: true, force: true });
    const all = fs.readdirSync(path.dirname(bk)).sort();
    while (all.length > 3) fs.rmSync(path.join(path.dirname(bk), all.shift()), { recursive: true, force: true });
    log('cache de shaders reiniciada (' + why + ')'); return true;
  } catch (e) { log('cache de shaders: ' + e.message); return false; }
}

// respaldo de las partidas antes de cada sesion (se guardan los 5 ultimos en data\respaldos)
function backupSaves() {
  try {
    const src = path.join(paths.saves, '0000000000000000');
    if (!exists(src)) return;
    const root = path.join(DATA, 'respaldos'), stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    fs.cpSync(src, path.join(root, stamp), { recursive: true });
    const all = fs.readdirSync(root).sort();
    while (all.length > 5) fs.rmSync(path.join(root, all.shift()), { recursive: true, force: true });
  } catch (e) { log('respaldo de partidas: ' + e.message); }
}
const send = (type, data) => { if (win && !win.isDestroyed()) win.webContents.send('msg', JSON.stringify({ type, data })); };

function listShots() {
  try {
    return fs.readdirSync(paths.shots)
      .filter((n) => /\.(png|jpe?g)$/i.test(n))
      .map((n) => ({ n, t: fs.statSync(path.join(paths.shots, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t).slice(0, 120);
  } catch (e) { return []; }
}
function state() {
  return {
    config: cfg,
    fullscreen: !!(win && win.isFullScreen()),
    suyuOk: !!engineExe(),
    keysOk: exists(path.join(keysDir(), 'prod.keys')),
    gameOk: exists(path.join(paths.dir, 'exefs', 'main')) && exists(path.join(paths.dir, 'exefs', 'romfs.bin')),
    engine: engineName(),
    fpsModOk: exists(path.join(paths.load, '60 FPS')) || exists(path.join(paths.loadOff, '60 FPS')),
    achievements: readJson(ACH, { unlocked: {} }),
    shots: listShots(),
    needsSetup: !engineExe() || !exists(path.join(paths.dir, 'exefs', 'romfs.bin')),
    suyuBundled: exists(path.join(paths.suyu, 'suyu.exe')),
    personal: { hero: exists(path.join(paths.personal, 'hero.jpg')) || exists(path.join(paths.personal, 'hero.png')), music: exists(path.join(paths.personal, 'music.mp3')) },
    baseAtlas: exists(BASE_ATLAS)
  };
}

// archivos de la interfaz del juego (iconos de botones), sacados del juego del propio usuario
function ensureGamePack() {
  const romfsFile = path.join(paths.dir, 'exefs', 'romfs.bin');
  if (!exists(romfsFile)) return false;
  const G = require('./gamepack');
  try {
    if (!PACK_FILES.every((f) => exists(path.join(GAME_PACK, f)))) {
      const done = G.extractOriginals(romfsFile, GAME_PACK, PKZ_BACKUP, PACK_FILES);
      log('iconos: archivos del juego listos (' + done.join(', ') + ')');
    }
    if (!exists(BASE_ATLAS) && exists(path.join(GAME_PACK, 'ui_core.dtt'))) G.writeBaseAtlas(path.join(GAME_PACK, 'ui_core.dtt'), BASE_ATLAS);
    return true;
  } catch (e) { log('iconos del juego: ' + e.message); return false; }
}
// los parches incluidos (60 FPS y cinematicas) se copian al juego si faltan
function ensureMods() {
  for (const mod of ['60 FPS', 'Cinematicas 30 FPS']) {
    if (exists(path.join(paths.load, mod)) || exists(path.join(paths.loadOff, mod))) continue;
    const src = path.join(paths.modsSrc, TITLE_ID, mod);
    if (exists(src)) { try { fs.cpSync(src, path.join(paths.loadOff, mod), { recursive: true }); log('parche copiado: ' + mod); } catch (e) { log('parche ' + mod + ': ' + e.message); } }
  }
}

// ---------------- qt-config.ini de suyu: cambia claves conservando el resto
// Las claves de suyu son unicas en todo el archivo; si falta alguna se agrega a su seccion.
function setQt(sections) {
  let text = '';
  try { text = fs.readFileSync(paths.ini, 'utf8'); } catch (e) { log('qt-config.ini no existe todavia'); }
  const lines = text.split(/\r?\n/);
  for (const [section, entries] of Object.entries(sections)) {
    for (const [key, val] of Object.entries(entries)) {
      let hit = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(key + '=')) { lines[i] = key + '=' + val; hit = true; }
        else if (lines[i].startsWith(key + '\\default=')) lines[i] = key + '\\default=false';
      }
      if (!hit) {
        let s = lines.findIndex((l) => l.trim() === '[' + section + ']');
        if (s < 0) { lines.push('', '[' + section + ']'); s = lines.length - 1; }
        lines.splice(s + 1, 0, key + '\\default=false', key + '=' + val);
      }
    }
  }
  fs.mkdirSync(path.dirname(paths.ini), { recursive: true });
  fs.writeFileSync(paths.ini, lines.join('\n'));
}

// enums verificados en suyu.exe (ResolutionSetup, VSyncMode, AntiAliasing, ScalingFilter, GpuAccuracy, Language)
const RES = { '1': 3, '1.5': 5, '2': 6, '3': 7 };
const LANG = { es419: 14, es: 5, en: 1, ja: 0 };
// ScalingFilter de este build (tipo Eden): NearestNeighbor, Bilinear, Bicubic, ZeroTangent, BSpline, Mitchell, Spline1, Gaussian, Lanczos, ScaleForce, Fsr...
const FILTER = { bilinear: 1, bicubic: 2, fsr: 10 };
const AA = { off: 0, fxaa: 1, smaa: 2 };
// sdl2-config.ini del export (mismo formato que el qt-config.ini de suyu, sin la seccion de la interfaz)
function writeSuyuConfig() {
  setQt({
    Renderer: {
      backend: 1,
      resolution_setup: RES[cfg.res] || 6,
      use_vsync: cfg.vsync === 'off' ? 0 : 1,                          // Immediate / Mailbox
      scaling_filter: FILTER[cfg.filter] ?? 1,
      anti_aliasing: AA[cfg.aa] ?? 0,
      gpu_accuracy: cfg.accuracy === 'high' ? 2 : 1,                     // GpuAccuracy: 0 Low, 1 Normal, 2 High
      fullscreen_mode: cfg.mode === 'full' ? 1 : 0,                     // 1 exclusiva, 0 sin bordes
      use_asynchronous_shaders: 'true',
      use_disk_shader_cache: 'true',
      use_vulkan_driver_pipeline_cache: 'true',
      use_video_framerate: 'true',
      async_presentation: 'true',
      nvdec_emulation: 2,
      // Texturas ASTC de los personajes (4096x4096, 17 por modelo): descomprimidas a RGBA8 llenan la memoria de
      // video y el emulador las descarta (oficial gris, parches en la cara). Se recomprimen a BC3 (4 veces menos
      // memoria) y se deja usar mas VRAM. accelerate_astc: 0 CPU, 1 GPU, 2 CPU en segundo plano.
      // probado: recomprimir a BC3 rompe los graficos en esta version (se deja sin recomprimir).
      // VRAM agresiva: deja al emulador usar mas memoria de video para las texturas grandes de los personajes.
      // ASTC en segundo plano con el procesador: quita los tirones al cargar cinematicas/zonas, que desfasan el
      // audio (problema conocido de Astral Chain); a cambio una textura recien cargada puede tardar un instante.
      accelerate_astc: cfg.astcAsync === 'off' ? 1 : 2,
      astc_recompression: 0,                                           // 0 sin comprimir, 1 BC1, 2 BC3
      vram_usage_mode: 0                                               // 0 conservador, 1 agresivo
    },
    System: { language_index: LANG[cfg.lang] ?? 14, region_index: 1, use_docked_mode: 1, application_version_override: 65536, application_display_version_override: '1.0.1' },
    Audio: { volume: 100 }
  });
  // Modo compatibilidad: emulacion de GPU mas fiel (y algo mas lenta) para errores de dibujo como el uniforme
  // gris del oficial. Se escriben siempre los dos juegos de valores para que apagarlo vuelva a lo normal.
  const C = cfg.gfxCompat === 'on';
  setQt({ Renderer: {
    gpu_accuracy: C ? 2 : (cfg.accuracy === 'high' ? 2 : 1),
    dma_accuracy: C ? 2 : 0,                                  // 0 por defecto, 1 inseguro, 2 seguro
    dyna_state: C ? 0 : 2,                                    // estado dinamico extendido de Vulkan
    vertex_input_dynamic_state: C ? 'false' : 'true',
    use_graphics_pipeline_library: C ? 'false' : 'true',
    use_asynchronous_shaders: 'true',                         // en segundo plano tambien en compatibilidad (sin tirones)
    async_presentation: C ? 'false' : 'true',
    enable_compute_pipelines: C ? 'true' : 'false',
    use_fast_gpu_time: C ? 'false' : 'true',
    sync_memory_operations: C ? 'true' : 'false',
    use_reactive_flushing: 'true'
  } });
  // sin Discord: el juego no se conecta a nada
  try { fs.writeFileSync(path.join(paths.dir, 'discord.ini'), '# Lo escribe el launcher: sin Discord\r\nenabled=0\r\ncover_url=\r\n'); } catch (e) {}
  fs.mkdirSync(paths.shots, { recursive: true });
}

// 60 fps: el parche y el arreglo de cinematicas se activan o se apartan juntos
// ---------------- controles: mando Xbox o teclado + raton (suyu solo admite un dispositivo por jugador)
// Cada accion del juego (boton de Switch) se asigna a un "token":
//   mando:   b0..b9 (A B X Y LB RB View Menu LS RS en SDL), lt, rt, du dd dl dr (cruceta)
//   teclado: k<codigo Qt> o m<boton de raton> (0 izq, 1 der, 2 rueda, 3 atras, 4 adelante)
const PAD_STORE = path.join(DATA, 'mando.json');
const ACTIONS = ['a', 'b', 'x', 'y', 'l', 'r', 'zl', 'zr', 'plus', 'minus', 'lstick', 'rstick', 'dup', 'ddown', 'dleft', 'dright'];
const PAD_DEF = { a: 'b1', b: 'b0', x: 'b3', y: 'b2', l: 'b4', r: 'b5', zl: 'lt', zr: 'rt', plus: 'b7', minus: 'b6', lstick: 'b8', rstick: 'b9',
  dup: 'du', ddown: 'dd', dleft: 'dl', dright: 'dr' };
const KB_DEF = { a: 'k69', b: 'k81', x: 'm1', y: 'm0', l: 'k90', r: 'k70', zl: 'k16777248', zr: 'k32', plus: 'k82', minus: 'k16777217', lstick: 'k67', rstick: 'm2',
  dup: 'k49', ddown: 'k50', dleft: 'k51', dright: 'k52', mup: 'k87', mdown: 'k83', mleft: 'k65', mright: 'k68', walk: 'k16777251' };
const tokOk = (t) => typeof t === 'string' && /^(b\d{1,2}|lt|rt|du|dd|dl|dr|k\d{1,9}|m[0-4])$/.test(t);
const padMap = () => Object.assign({}, PAD_DEF, Object.fromEntries(Object.entries(cfg.padMap || {}).filter(([, v]) => tokOk(v))));
const kbMap = () => Object.assign({}, KB_DEF, Object.fromEntries(Object.entries(cfg.kbMap || {}).filter(([, v]) => tokOk(v))));
function padGuid() {
  const st = readJson(PAD_STORE, {});
  for (const v of Object.values(st)) { const m = String(v).match(/guid:([0-9a-f]+)/); if (m) return m[1]; }
  return null;
}
function padParam(tok, guid) {
  const base = 'engine:sdl,port:0,guid:' + guid + ',';
  if (/^b\d+$/.test(tok)) return '"' + base + 'button:' + tok.slice(1) + '"';
  if (tok === 'lt') return '"' + base + 'axis:2,threshold:0.500000,invert:+"';
  if (tok === 'rt') return '"' + base + 'axis:5,threshold:0.500000,invert:+"';
  const dir = { du: 'up', dd: 'down', dl: 'left', dr: 'right' }[tok];
  if (dir) return '"' + base + 'hat:0,direction:' + dir + '"';
  return '[empty]';
}
// El launcher guarda las teclas con codigos de Qt (como suyu), pero la version exportada (suyu-cmd, SDL)
// recibe las teclas como "scancodes" de SDL: se traducen al escribir la configuracion.
const QT2SDL = (() => {
  const m = {};
  for (let i = 0; i < 26; i++) m[65 + i] = 4 + i;                        // A-Z
  for (let i = 1; i <= 9; i++) m[48 + i] = 29 + i; m[48] = 39;            // 1-9, 0
  for (let i = 1; i <= 12; i++) m[16777263 + i] = 57 + i;                 // F1-F12
  Object.assign(m, {
    32: 44, 16777217: 43, 16777220: 40, 16777221: 88, 16777219: 42, 16777216: 41,  // espacio, tab, enter, enter num, retroceso, esc
    16777248: 225, 16777249: 224, 16777251: 226, 16777252: 57,                       // shift, ctrl, alt, bloq mayus (izquierdos)
    16777234: 80, 16777235: 82, 16777236: 79, 16777237: 81,                          // flechas
    16777222: 73, 16777223: 76, 16777232: 74, 16777233: 77, 16777238: 75, 16777239: 78,
    45: 45, 61: 46, 91: 47, 93: 48, 92: 49, 59: 51, 39: 52, 96: 53, 44: 54, 46: 55, 47: 56
  });
  return m;
})();
const sdlKey = (qt) => QT2SDL[qt] ?? 0;
const kbInner = (tok) => tok[0] === 'm' ? 'engine:mouse,port:0,button:' + tok.slice(1) + ',toggle:0' : 'engine:keyboard,code:' + sdlKey(+tok.slice(1)) + ',toggle:0';
const kbParam = (tok) => '"' + kbInner(tok) + '"';
// boton dentro de analog_from_button: ':' -> $0  ',' -> $1
const nest = (tok) => kbInner(tok).replace(/:/g, '$0').replace(/,/g, '$1');
function readQt() { try { return fs.readFileSync(paths.ini, 'utf8').split(/\r?\n/); } catch (e) { return []; } }

// Iconos de botones del juego. Cada idioma tiene su propia copia del atlas de botones dentro de
// ui_core[_xx].dtt (textura 0 de core.wtp: 256x512 RGBA8 block-linear). El juego en espanol usa
// ui_core_es.dtt, en ingles ui_core_us.dtt y el resto ui_core.dtt, asi que se parchean los tres.
// Copias originales del juego en data\botones\juego; el resultado va a load\...\Botones\romfs\ui
const PACK_DIR = path.join(DATA, 'botones');
const GAME_PACK = path.join(PACK_DIR, 'juego');
const PACK_FILES = ['ui_core.dtt', 'ui_core_es.dtt', 'ui_core_us.dtt'];
function migratePacks() {
  // los paquetes viejos (base de otro mod, sin el archivo en espanol) ya no se usan
  for (const n of ['Botones Xbox', 'Botones Teclado']) for (const root of [paths.load, paths.loadOff]) {
    try { if (exists(path.join(root, n))) fs.rmSync(path.join(root, n), { recursive: true, force: true }); } catch (e) {}
  }
  for (const k of ['xbox', 'teclado']) { try { fs.rmSync(path.join(PACK_DIR, k), { recursive: true, force: true }); } catch (e) {} }
}
const ATLAS = { w: 256, h: 512, bh: 16, size: 0x80000 };
function swizzleAtlas(rgba) {
  const wb = ATLAS.w * 4, gobsW = wb / 64, out = Buffer.alloc(ATLAS.size);
  for (let y = 0; y < ATLAS.h; y++) {
    const gy = Math.floor(y / (8 * ATLAS.bh)) * (512 * ATLAS.bh * gobsW) + Math.floor((y % (8 * ATLAS.bh)) / 8) * 512, yi = y % 8;
    for (let x = 0; x < wb; x += 16) {   // 16 bytes seguidos son contiguos dentro del GOB
      const xi = x % 64, a = gy + Math.floor(x / 64) * (512 * ATLAS.bh) + Math.floor(xi / 32) * 256 + Math.floor(yi / 2) * 64 + Math.floor((xi % 32) / 16) * 32 + (yi % 2) * 16;
      rgba.copy(out, a, y * wb + x, y * wb + x + 16);
    }
  }
  return out;
}
// posicion de core.wtp dentro del .dtt (contenedor DAT de Platinum): el atlas es su primera textura
function atlasOffset(buf) {
  if (buf.toString('latin1', 0, 4) !== 'DAT\0') return -1;
  const n = buf.readUInt32LE(4), offo = buf.readUInt32LE(8), nameo = buf.readUInt32LE(16), sizeo = buf.readUInt32LE(20);
  const nlen = buf.readUInt32LE(nameo);
  for (let i = 0; i < n; i++) {
    const nm = buf.toString('latin1', nameo + 4 + i * nlen, nameo + 4 + (i + 1) * nlen).split('\0')[0];
    if (nm === 'core.wtp' && buf.readUInt32LE(sizeo + i * 4) >= ATLAS.size) return buf.readUInt32LE(offo + i * 4);
  }
  return -1;
}
// El juego no pinta el color del atlas: usa el ALFA como la forma del icono (tenida de blanco) y el
// canal de COLOR como la silueta oscura de fondo (un poco mas grande). En los originales la letra es
// un hueco en el alfa. Aqui se convierten los iconos dibujados (color + alfa) a ese formato:
//   alfa  = partes claras del icono (aro, letra, relleno blanco); lo oscuro queda como hueco
//   color = silueta completa del icono, ensanchada 3 px y suavizada
function toGameAtlas(rgba) {
  const W = ATLAS.w, H = ATLAS.h, N = W * H, out = Buffer.alloc(N * 4);
  const sil = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3] / 255;
    const ink = Math.min(1, Math.max(0, (Math.max(r, g, b) - 60) / 100));
    sil[i] = a;
    out[i * 4 + 3] = Math.round(a * ink * 255);
  }
  // ensanchar la silueta (disco de radio 3) y suavizar (caja 3x3)
  const R = 3, dil = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx < 0 || xx >= W || dx * dx + dy * dy > R * R + 1) continue;
        const v = sil[yy * W + xx]; if (v > m) m = v; } }
    dil[y * W + x] = m;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue; s += dil[yy * W + xx]; n++; }
    const v = Math.round(s / n * 255), i = (y * W + x) * 4;
    out[i] = out[i + 1] = out[i + 2] = v;
  }
  return out;
}
// atlas por defecto (sin cambios de controles): atlas base del juego del usuario + iconos dibujados del launcher
// (xbox_overlay.png / teclado_overlay.png, solo en los huecos de drawn.json)
function defaultAtlas(kb) {
  try {
    if (!exists(BASE_ATLAS)) return null;
    const out = Buffer.from(fs.readFileSync(BASE_ATLAS));
    if (out.length !== ATLAS.w * ATLAS.h * 4) return null;
    const { nativeImage } = require('electron');
    const B = path.join(UI, 'assets', 'botones');
    const img = nativeImage.createFromPath(path.join(B, kb ? 'teclado_overlay.png' : 'xbox_overlay.png'));
    const sz = img.getSize(); if (sz.width !== ATLAS.w || sz.height !== ATLAS.h) return out;
    const slots = readJson(path.join(B, 'slots.json'), {}), drawn = readJson(path.join(B, 'drawn.json'), {})[kb ? 'teclado' : 'xbox'] || [];
    const bgra = img.toBitmap();
    for (const n of drawn) {
      const s = slots[n]; if (!s) continue;
      for (let y = s[1]; y <= s[3]; y++) for (let x = s[0]; x <= s[2]; x++) {
        const i = (y * ATLAS.w + x) * 4, al = bgra[i + 3], k = al ? 255 / al : 0;   // toBitmap viene premultiplicado
        out[i] = Math.min(255, Math.round(bgra[i + 2] * k)); out[i + 1] = Math.min(255, Math.round(bgra[i + 1] * k)); out[i + 2] = Math.min(255, Math.round(bgra[i] * k)); out[i + 3] = al;
      }
    }
    return out;
  } catch (e) { log('atlas por defecto: ' + e.message); return null; }
}
// donde el atlas del launcher no cambio respecto al atlas base, se deja el pixel original del juego tal cual
function keepOriginal(gameAtlas, raw, origDtt) {
  try {
    if (!exists(BASE_ATLAS)) return gameAtlas;
    const base = fs.readFileSync(BASE_ATLAS), off = atlasOffset(origDtt);
    if (off < 0 || base.length !== raw.length) return gameAtlas;
    const orig = require('./gamepack').deswizzleAtlas(origDtt.subarray(off, off + ATLAS.w * ATLAS.h * 4));
    for (let i = 0; i < raw.length; i += 4) {
      if (raw[i] === base[i] && raw[i + 1] === base[i + 1] && raw[i + 2] === base[i + 2] && raw[i + 3] === base[i + 3]) orig.copy(gameAtlas, i, i, i + 4);
    }
    return gameAtlas;
  } catch (e) { log('atlas original: ' + e.message); return gameAtlas; }
}
// La version exportada no aplica mods de romfs (LayeredFS). Los ui_core*.dtt con el atlas parcheado se
// recomprimen con zstd y se escriben en su mismo hueco dentro de ui.pkz (en exefs\romfs.bin): nada cambia
// de tamano ni de lugar. Los originales se guardan en data\ui_pkz_original (scripts\10_RESTAURAR_ROMFS.bat).
const ROMFS_ORIG = path.join(DATA, 'romfs_original.json');
const PKZ_BACKUP = path.join(DATA, 'ui_pkz_original');
const PACK_STATE = path.join(DATA, 'botones_estado.json');
async function installPack(kb, atlasB64) {
  const romfsFile = path.join(paths.dir, 'exefs', 'romfs.bin');
  if (!exists(romfsFile)) { log('no existe ' + romfsFile); return; }
  // deshacer el intento anterior (archivos sueltos agregados al final de romfs.bin: el juego no los usa)
  if (exists(ROMFS_ORIG)) {
    try {
      const o = readJson(ROMFS_ORIG, null);
      if (o && o.size && fs.statSync(romfsFile).size > o.size) { require('./romfs').restore(romfsFile, o); log('romfs.bin devuelto a su tamano original (' + o.size + ')'); }
      fs.renameSync(ROMFS_ORIG, ROMFS_ORIG + '.restaurado');
    } catch (e) { log('restaurar romfs.bin: ' + e.message); return; }
  }
  // iconos originales de Switch: se vuelve a poner el contenido original de ui.pkz
  if (cfg.btnIcons === 'orig') {
    const idx = path.join(PKZ_BACKUP, 'pkz_original.json');
    if (exists(idx)) {
      try { require('./pkz').restore(PKZ_BACKUP, romfsFile); fs.rmSync(PACK_STATE, { force: true }); log('Botones del juego: originales de Switch (ui.pkz restaurado)'); }
      catch (e) { log('restaurar ui.pkz: ' + e.message); }
    } else log('Botones del juego: originales de Switch');
    return;
  }
  const files = PACK_FILES.filter((f) => exists(path.join(GAME_PACK, f)));
  if (!files.length) { log('faltan los archivos originales en ' + GAME_PACK); return; }
  let raw = atlasB64 ? Buffer.from(atlasB64, 'base64') : defaultAtlas(kb);
  if (!raw || raw.length !== ATLAS.w * ATLAS.h * 4) { log('atlas de botones no valido: ' + (raw ? raw.length : 'vacio')); return; }
  const patch = swizzleAtlas(keepOriginal(toGameAtlas(raw), raw, fs.readFileSync(path.join(GAME_PACK, files[0]))));
  // si ya esta puesto exactamente este atlas, no se toca nada (arranque instantaneo)
  const key = require('crypto').createHash('sha1').update(patch).update(files.join('|')).digest('hex');
  const st0 = fs.statSync(romfsFile), prev = readJson(PACK_STATE, {});
  if (prev.key === key && prev.size === st0.size && Math.abs((prev.mtime || 0) - st0.mtimeMs) < 2000) { log('Botones del juego: ' + (kb ? 'teclado' : 'Xbox') + ' (ya aplicados)'); return; }
  const out = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(GAME_PACK, f));
    const off = atlasOffset(buf);
    if (off < 0) { log('no se encontro el atlas en ' + f); continue; }
    patch.copy(buf, off);
    out.push({ name: f, data: buf });
  }
  try {
    const R = require('./romfs'), T = R.load(romfsFile), ui = R.findDir(T, 'ui');
    const pk = ui === 0xFFFFFFFF ? null : R.listFiles(T, ui)['ui.pkz'];
    if (!pk) throw new Error('no se encontro /ui/ui.pkz');
    await require('./pkz').replace(romfsFile, pk.abs, pk.size, out, PKZ_BACKUP, log);
    const st1 = fs.statSync(romfsFile);
    fs.writeFileSync(PACK_STATE, JSON.stringify({ key, size: st1.size, mtime: st1.mtimeMs, kb }, null, 1));
    log('Botones del juego: ' + (kb ? 'teclado' : 'Xbox') + ' -> ui.pkz (' + out.map((o) => o.name).join(', ') + ')');
  } catch (e) { log('botones en ui.pkz: ' + e.message); }
  // el mod de romfs no sirve en esta version
  try { fs.rmSync(path.join(paths.load, 'Botones'), { recursive: true, force: true }); } catch (e) {}
}

async function applyInput(atlasB64) {
  const lines = readQt(), cur = {};
  for (const l of lines) { const m = l.match(/^(player_0_(?:button_\w+|lstick|rstick))=(.*)$/); if (m) cur[m[1]] = m[2]; }
  // la configuracion original del mando se guarda mientras suyu la tenga puesta
  if (Object.values(cur).some((v) => v.includes('engine:sdl'))) { try { fs.writeFileSync(PAD_STORE, JSON.stringify(cur, null, 1)); } catch (e) {} }
  const kb = cfg.input === 'kb';
  const B = {};
  if (kb) {
    const M = kbMap();
    for (const a of ACTIONS) B['player_0_button_' + a] = kbParam(M[a]);
    B.player_0_lstick = '"engine:analog_from_button,up:' + nest(M.mup) + ',left:' + nest(M.mleft) + ',modifier:' + nest(M.walk) + ',down:' + nest(M.mdown) + ',right:' + nest(M.mright) + ',modifier_scale:0.500000"';
    B.player_0_rstick = cfg.minvert === 'on'
      ? '"engine:mouse,axis_x:0,axis_y:1,deadzone:0.000000,range:1.000000,invert_y:-,port:0"'
      : '"engine:mouse,axis_x:0,axis_y:1,deadzone:0.000000,range:1.000000,port:0"';
  } else {
    const guid = padGuid(), st = readJson(PAD_STORE, null);
    if (guid && st) {
      const M = padMap();
      for (const a of ACTIONS) B['player_0_button_' + a] = padParam(M[a], guid);
      B.player_0_lstick = st.player_0_lstick; B.player_0_rstick = st.player_0_rstick;
    } else log('aun no hay configuracion del mando guardada');
  }
  for (const k of ['slleft', 'srleft', 'slright', 'srright', 'home', 'screenshot']) if (Object.keys(B).length) B['player_0_button_' + k] = '[empty]';
  const sens = Math.max(1, Math.min(100, parseInt(cfg.msens, 10) || 50));
  setQt({ Controls: Object.assign(B, { mouse_panning: kb ? 'true' : 'false', mouse_panning_sensitivity: sens, mouse_panning_x_sensitivity: sens, mouse_panning_y_sensitivity: sens }) });
  migratePacks();
  await installPack(kb, atlasB64);
  log('Controles: ' + (kb ? 'teclado y raton' : 'mando Xbox'));
}

function applyFps() {
  const on = cfg.fps !== '30', cut = on && cfg.cut30 === 'on';
  for (const [mod, want] of [['60 FPS', on], ['Cinematicas 30 FPS', cut]]) {
    const a = path.join(paths.load, mod), b = path.join(paths.loadOff, mod);
    try {
      if (want && !exists(a) && exists(b)) { fs.mkdirSync(paths.load, { recursive: true }); fs.renameSync(b, a); }
      if (!want && exists(a)) { fs.mkdirSync(paths.loadOff, { recursive: true }); fs.rmSync(b, { recursive: true, force: true }); fs.renameSync(a, b); }
    } catch (e) { log('fps ' + mod + ': ' + e.message); }
  }
  log('FPS: ' + (on ? (cut ? '60 (cinematicas a 30)' : '60 (cinematicas tambien a 60)') : '30 original'));
}

// ---------------- aviso de logro (ventana transparente encima del juego, sin robar el foco)
let toastQueue = [], toastBusy = false, toastSeq = 0;
const TOAST_W = 640, TOAST_H = 170;
function createToastWindow() {
  const d = screen.getPrimaryDisplay().bounds;
  toastWin = new BrowserWindow({
    x: d.x + d.width - TOAST_W - 24, y: d.y + 24, width: TOAST_W, height: TOAST_H, show: false, frame: false, transparent: true,
    resizable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  toastWin.setAlwaysOnTop(true, 'screen-saver');
  toastWin.setIgnoreMouseEvents(true);
  toastWin.setMenu(null);
  toastWin.loadURL('ac://ui/toast.html');
}
function showAchievement(a) {
  if (cfg.achToast === 'off') return;
  toastQueue.push(Object.assign({ lang: cfg.ui || 'es', sound: cfg.sfx !== 'off' }, a));
  nextToast();
}
function nextToast() {
  if (toastBusy || !toastQueue.length || !toastWin || toastWin.isDestroyed()) return;
  toastBusy = true;
  const d = screen.getPrimaryDisplay().bounds;
  toastWin.setBounds({ x: d.x + d.width - TOAST_W - 24, y: d.y + 24, width: TOAST_W, height: TOAST_H });
  toastWin.showInactive();
  toastWin.setAlwaysOnTop(true, 'screen-saver');
  toastWin.webContents.send('msg', JSON.stringify({ type: 'show', data: toastQueue.shift() }));
  const id = ++toastSeq;
  setTimeout(() => { if (toastBusy && id === toastSeq) { toastBusy = false; nextToast(); } }, 9000);
}

// ---------------- puente de mando + menu de pausa
const sendExit = (type, data) => { if (exitWin && !exitWin.isDestroyed()) exitWin.webContents.send('msg', JSON.stringify({ type, data })); };
const bridgeCmd = (s) => { try { if (bridge && bridge.stdin.writable) bridge.stdin.write(s + '\n'); } catch (e) {} };
const hwnd = (w) => { const b = w.getNativeWindowHandle(); return (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString(); };

function createExitWindow() {
  const d = screen.getPrimaryDisplay().bounds;
  exitWin = new BrowserWindow({
    x: d.x, y: d.y, width: d.width, height: d.height, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  exitWin.setAlwaysOnTop(true, 'screen-saver');
  exitWin.setMenu(null);
  exitWin.loadURL('ac://ui/exit.html');
}
function startBridge() {
  stopBridge();
  bridge = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'bridge.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  bridge.stdout.on('data', (d) => {
    buf += d.toString(); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('COMBO')) openExit(line === 'COMBO KB' ? 'kb' : 'pad');
      else if (line.startsWith('BTN ') && exitOpen) sendExit('btn', line.slice(4));
      else if (line === 'AUDIO OK' || line === 'AUDIO NO') { const v = line === 'AUDIO OK' ? 'ok' : 'no'; if (cfg.audioCtl !== v) { cfg.audioCtl = v; saveCfg(); } }
      else if (line.startsWith('VOLSET')) log('volumen del juego: ' + line.slice(7) + '%');
      else if (line === 'GAMEUP') { gameSeen = true; log('juego en marcha'); }
      else if (line.startsWith('SHOT ')) { log('captura: ' + line.slice(5)); send('shots', listShots()); }
    }
  });
  bridge.on('error', (e) => { log('puente: ' + e.message); bridge = null; });
  bridge.on('exit', () => { bridge = null; });
}
function stopBridge() { if (bridge) { bridgeCmd('QUIT'); const b = bridge; setTimeout(() => { try { b.kill(); } catch (e) {} }, 500); bridge = null; } }
function setGameVolume(v) { if (game && !paused && cfg.audioCtl !== 'no') bridgeCmd('VOLUME ' + game.pid + ' ' + Math.max(0, Math.min(100, parseInt(v, 10) || 0))); }
// pausa: el juego no se pausa solo al perder el foco, asi que se congela el proceso y se silencia
let paused = false;
function freeze(on) {
  if (!game || paused === on) return;
  paused = on;
  if (on) { bridgeCmd('VOLUME ' + game.pid + ' 0'); setTimeout(() => { if (paused && game) bridgeCmd('SUSPEND ' + game.pid); }, 150); }
  else { bridgeCmd('RESUME ' + game.pid); setGameVolume(cfg.gvol || '100'); }
}
// cierre ordenado (guarda partida/configuracion); si no responde en 8 s, se fuerza
function closeSuyu() {
  if (!game) return;
  const g = game;
  freeze(false);
  bridgeCmd('CLOSEPID ' + g.pid);
  setTimeout(() => { if (game === g) { log('el juego no respondio: se fuerza el cierre'); try { g.kill(); } catch (e) {} } }, 8000);
}

function openExit(via) {
  if (!game || exitOpen || !exitWin) return;
  exitOpen = true;
  exitWin.setBounds(screen.getPrimaryDisplay().bounds);
  exitWin.show(); exitWin.setAlwaysOnTop(true, 'screen-saver');
  bridgeCmd('FOCUS ' + hwnd(exitWin));
  freeze(true);
  exitWin.focus();
  sendExit('show', { lang: cfg.ui || 'es', via: via || 'pad', gvol: cfg.gvol || '100' });
}
function closeExit(back) {
  exitOpen = false;
  if (back) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.show(); if (cfg.launcherFull !== 'off') win.setFullScreen(true); else if (win.isFullScreen()) win.setFullScreen(false);
    launchFull = false; send('launchHide');
    bridgeCmd('FOCUS ' + hwnd(win)); win.focus();
    setTimeout(() => { exitWin.hide(); sendExit('hide'); }, 120);
    closeSuyu();
  } else {
    exitWin.hide(); sendExit('hide');
    freeze(false);
    if (game) bridgeCmd('FOCUSPID ' + game.pid);
  }
}

// ---------------- jugar
let starting = false;
async function play(atlas) {
  if (game || starting) return;
  const exe = engineExe();
  if (!exe) throw new Error('No encuentro el juego en ' + paths.dir);
  if (!exists(path.join(keysDir(), 'prod.keys'))) throw new Error('Faltan las claves (prod.keys) en ' + keysDir());
  fixPortablePaths();
  backupSaves();
  if (!cfg.shaderReset1) { resetShaderCache('primera vez con la version JIT'); cfg.shaderReset1 = 1; saveCfg(); }
  writeProfileName(cfg.pname);
  writeSuyuConfig();
  ensureMods();
  ensureGamePack();
  applyFps();
  starting = true;
  try { await applyInput(atlas); } finally { starting = false; }
  if (game) return;
  const args = [];
  if (cfg.mode !== 'window') args.push('-f');
  log('Iniciando: ' + exe + ' ' + args.join(' '));
  win.setAlwaysOnTop(true, 'screen-saver');
  if (!win.isFullScreen()) { launchFull = true; win.setFullScreen(true); }
  gameSeen = false;
  game = spawn(exe, args, { cwd: paths.dir, stdio: 'ignore' });
  gameStart = Date.now();
  startBridge();
  bridgeCmd('GAMEPID ' + game.pid);
  bridgeCmd('WATCH ' + game.pid);
  bridgeCmd('SHOTS ' + paths.shots);
  setGameVolume(cfg.gvol || '100');
  const myGame = game;
  // La animacion de inicio sigue hasta que suyu termina de cargar/compilar los shaders guardados y el juego
  // empieza a ejecutarse. Se sigue en el registro de suyu (user\log\suyu_log.txt, se reescribe en cada arranque):
  //   "LoadDiskResources: Total Pipeline Count: N"  -> empieza la carga de shaders (N en total)
  //   "CreateGraphicsPipeline / CreateComputePipeline" -> shaders listos (progreso)
  //   "SetWindowSystem: pending process arrived"    -> el juego ya corre
  const logFile = paths.log;
  const t0 = Date.now();
  let total = 0, done = 0, pos = 0, ready = false, readyAt = 0, lastSent = '';
  const readLog = () => {
    try {
      const st = fs.statSync(logFile);
      if (st.mtimeMs < t0 - 2000) return;              // todavia es el registro de la vez anterior
      if (st.size < pos) pos = 0;
      if (st.size === pos) return;
      const fd = fs.openSync(logFile, 'r'); const buf = Buffer.alloc(st.size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos); fs.closeSync(fd); pos = st.size;
      const txt = buf.toString('utf8');
      const m = txt.match(/Total Pipeline Count: (\d+)/); if (m) total = +m[1];
      done += (txt.match(/Create(Graphics|Compute)Pipeline/g) || []).length;
      if (!ready && /pending process arrived|BootGame: Booting game[\s\S]*Service\.(SET|AM|HID|VI)/.test(txt) && (total === 0 || /SerializeVulkanPipelineCache|pending process arrived/.test(txt))) { ready = true; readyAt = Date.now(); }
    } catch (e) {}
  };
  const hideWhenReady = () => {
    if (game !== myGame) return;
    readLog();
    const pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
    const info = JSON.stringify({ total, done: Math.min(done, total), pct, booting: gameSeen && !ready });
    if (info !== lastSent) { lastSent = info; send('launchProgress', JSON.parse(info)); }
    // listo: el juego corre desde hace 2.5 s (logos de arranque); respaldo: titulo de la ventana + 90 s
    const timeout = Date.now() - t0 > 90000;
    if ((ready && Date.now() - readyAt > 2500) || timeout) {
      log('juego listo (' + (ready ? 'shaders ' + Math.min(done, total) + '/' + total : 'por tiempo') + ', ' + Math.round((Date.now() - t0) / 100) / 10 + ' s)');
      send('gameUp');                                   // la interfaz termina la animacion y funde a negro
      if (cfg.mode === 'window') bridgeCmd('WINSIZE ' + myGame.pid + ' ' + WSIZE(cfg.wsize).join(' '));
      setTimeout(() => {
        if (game !== myGame || !win || win.isDestroyed()) return;
        win.setAlwaysOnTop(false); win.hide(); bridgeCmd('FOCUSPID ' + myGame.pid);
      }, 1100);
    } else setTimeout(hideWhenReady, 250);
  };
  setTimeout(hideWhenReady, 800);
  game.on('error', (e) => { log('Error al iniciar el juego: ' + e.message); game = null; win.setAlwaysOnTop(false); if (launchFull) { win.setFullScreen(false); launchFull = false; } win.show(); send('error', e.message); });
  game.on('exit', (code) => {
    const secs = Math.round((Date.now() - gameStart) / 1000);
    log('juego cerrado (codigo ' + code + ', ' + secs + ' s)');
    if (secs > 20) {
      cfg.playtime = (parseInt(cfg.playtime || 0, 10) || 0) + secs;
      cfg.sessions = (parseInt(cfg.sessions || 0, 10) || 0) + 1;
      cfg.lastPlayed = Date.now(); cfg.lastSession = secs; saveCfg();
    }
    game = null; paused = false;
    stopBridge();
    if (exitOpen) { exitOpen = false; exitWin.hide(); sendExit('hide'); }
    if (!win || win.isDestroyed()) return;
    win.show();
    if (launchFull && cfg.launcherFull === 'off') win.setFullScreen(false); else if (cfg.launcherFull !== 'off') win.setFullScreen(true);
    launchFull = false; win.focus();
    setTimeout(() => win.setAlwaysOnTop(false), 400);
    send('gameClosed', { config: cfg, shots: listShots() });
  });
  send('gameStarted');
}

// ---------------- asistente de primera vez
const PICK = {
  prodKeys: { title: 'prod.keys', filters: [{ name: 'prod.keys', extensions: ['keys'] }] },
  titleKeys: { title: 'title.keys', filters: [{ name: 'title.keys', extensions: ['keys'] }] },
  firmware: { title: 'Firmware (.zip)', filters: [{ name: 'Firmware', extensions: ['zip'] }] },
  firmwareDir: { title: 'Firmware', folder: true },
  base: { title: 'Astral Chain (base)', filters: [{ name: 'Nintendo Switch', extensions: ['nsp', 'xci'] }] },
  update: { title: 'Update 1.0.1', filters: [{ name: 'Nintendo Switch', extensions: ['nsp'] }] }
};
async function pickFile(what) {
  const p = PICK[what]; if (!p) return;
  const r = await dialog.showOpenDialog(win, { title: p.title, properties: [p.folder ? 'openDirectory' : 'openFile'], filters: p.filters });
  if (!r.canceled && r.filePaths[0]) send('setupPicked', { what: what === 'firmwareDir' ? 'firmware' : what, file: r.filePaths[0] });
}
let setupBusy = false;
async function runSetup(files) {
  if (setupBusy || !files) return;
  setupBusy = true;
  log('asistente: exportando el juego');
  try {
    const r = await require('./setup').exportGame(Object.assign({}, files, { suyuDir: paths.suyu, gameDir: paths.dir, modsSrc: paths.modsSrc }),
      (step, pct, msg) => send('setupProgress', { step, pct, msg: String(msg).slice(0, 200) }));
    try { fs.writeFileSync(path.join(DATA, 'exportacion.log'), r.log.join('\n')); } catch (e) {}
    fixPortablePaths();
    ensureMods();
    ensureGamePack();
    log('asistente: juego listo en ' + r.gameDir);
    send('setupDone', state());
  } catch (e) {
    log('asistente: ' + e.message);
    send('setupError', e.message);
  } finally { setupBusy = false; }
}

// arrastre de la ventana: el proceso principal sigue al raton mientras la interfaz mantiene pulsada la barra
let dragT = null;
function startDrag() {
  if (!win || win.isFullScreen()) return;
  stopDrag();
  const c = screen.getCursorScreenPoint(), [wx, wy] = win.getPosition(), [w, h] = win.getSize();
  const ox = c.x - wx, oy = c.y - wy;
  dragT = setInterval(() => {
    if (!win || win.isDestroyed()) return stopDrag();
    const p = screen.getCursorScreenPoint();
    win.setBounds({ x: p.x - ox, y: p.y - oy, width: w, height: h });
  }, 8);
  setTimeout(stopDrag, 60000);
}
function stopDrag() { if (dragT) { clearInterval(dragT); dragT = null; } }
function toggleFull(force) {
  if (!win) return;
  const on = typeof force === 'boolean' ? force : !win.isFullScreen();
  win.setFullScreen(on); cfg.launcherFull = on ? 'on' : 'off'; saveCfg();
}
// valores que solo maneja el proceso principal
const keep = () => ({ cut30fix: cfg.cut30fix, shaderReset1: cfg.shaderReset1, launcherFull: cfg.launcherFull, audioCtl: cfg.audioCtl, playtime: cfg.playtime, sessions: cfg.sessions, lastPlayed: cfg.lastPlayed, lastSession: cfg.lastSession });

ipcMain.on('msg', (_e, raw) => {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  try {
    switch (m.cmd) {
      case 'init': send('state', state()); break;
      case 'save': if (m.config) { cfg = Object.assign({}, DEFAULTS, m.config, keep()); saveCfg(); } break;
      case 'play': if (m.config) { cfg = Object.assign({}, DEFAULTS, m.config, keep()); saveCfg(); } play(m.atlas).catch((e) => { log('Error: ' + e.message); send('error', e.message); }); break;
      case 'minimize': win.minimize(); break;
      case 'dragStart': startDrag(); break;
      case 'dragEnd': stopDrag(); break;
      case 'toggleFull': toggleFull(); break;
      case 'close': app.quit(); break;
      case 'exitYes': closeExit(true); break;
      case 'exitNo': closeExit(false); break;
      case 'gvol': cfg.gvol = String(Math.max(0, Math.min(100, parseInt(m.value, 10) || 0))); saveCfg(); setGameVolume(cfg.gvol); send('cfgPatch', { gvol: cfg.gvol }); break;
      case 'shaderReset': send('toast', resetShaderCache('pedido desde ajustes') ? 'ok' : 'none'); break;
      case 'setupPick': pickFile(m.what); break;
      case 'setupRun': runSetup(m.files); break;
      case 'openSuyu': if (exists(path.join(paths.suyu, 'suyu.exe'))) spawn(path.join(paths.suyu, 'suyu.exe'), [], { cwd: paths.suyu, detached: true, stdio: 'ignore' }).unref(); break;
      case 'openFolder': { const f = { personal: paths.personal, install: path.dirname(ROOT), game: paths.dir }[m.which]; if (f) { fs.mkdirSync(f, { recursive: true }); shell.openPath(f); } break; }
      case 'rescan': ensureGamePack(); send('state', state()); break;
      case 'achTest': showAchievement({ title: m.title || 'Caso cerrado', description: m.description || 'Aviso de prueba del launcher.', mark: m.mark || '' }); break;
      case 'toastDone': toastBusy = false; if (toastQueue.length) nextToast(); else if (toastWin && !toastWin.isDestroyed()) toastWin.hide(); break;
      case 'shots': send('shots', listShots()); break;
      case 'openShots': fs.mkdirSync(paths.shots, { recursive: true }); shell.openPath(paths.shots); break;
    }
  } catch (e) { log('ERROR ' + m.cmd + ': ' + e.stack); send('error', e.message); }
});

function createWindow() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const fit = Math.min(1, (wa.width * 0.9) / 1600, (wa.height * 0.9) / 900);
  if (process.argv.includes('--windowed')) { cfg.launcherFull = 'off'; saveCfg(); }
  win = new BrowserWindow({
    width: Math.round(1600 * fit), height: Math.round(900 * fit), center: true,
    frame: false, resizable: true, maximizable: false, fullscreenable: true, minWidth: 800, minHeight: 450,
    backgroundColor: '#050a16', show: false, title: APP_NAME,
    icon: path.join(UI, 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenu(null);
  // si se cierra la ventana principal (Alt+F4, barra de tareas) se cierra todo el launcher:
  // las ventanas ocultas de pausa y logros no deben dejarlo vivo en segundo plano
  win.on('closed', () => { stopDrag(); win = null; if (game) closeSuyu(); app.quit(); });
  win.loadURL('ac://ui/index.html');
  win.setAspectRatio(16 / 9);
  win.once('ready-to-show', () => { win.show(); if (cfg.launcherFull !== 'off') win.setFullScreen(true); });
  win.on('enter-full-screen', () => send('fullscreen', true));
  win.on('leave-full-screen', () => send('fullscreen', false));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { e.preventDefault(); toggleFull(); }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } else createWindow(); });
  app.whenReady().then(async () => {
    fs.mkdirSync(DATA, { recursive: true });
    try { await session.defaultSession.clearCache(); } catch (e) {}
    // ac://ui/...    -> interfaz
    // ac://shots/... -> capturas (galeria)
    // ac://data/...  -> atlas de botones del juego del usuario e imagen/musica propias (data/personal)
    protocol.handle('ac', (req) => {
      const u = new URL(req.url);
      if (u.host === 'data') {
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
        const f = rel === 'base_atlas.rgba' ? BASE_ATLAS : path.resolve(paths.personal, rel.replace(/^personal\//, ''));
        if (f !== BASE_ATLAS && !f.startsWith(path.resolve(paths.personal))) return new Response('Prohibido', { status: 403 });
        if (!exists(f)) return new Response('', { status: 404 });
        return net.fetch(pathToFileURL(f).toString());
      }
      const base = u.host === 'shots' ? paths.shots : UI;
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const file = path.resolve(base, rel);
      if (!file.startsWith(path.resolve(base))) return new Response('Prohibido', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    createWindow();
    createExitWindow();
    createToastWindow();
    fixPortablePaths();
    fs.mkdirSync(paths.personal, { recursive: true });
    ensureGamePack();
    log('Launcher iniciado. juego: ' + (engineExe() || 'NO ENCONTRADO en ' + paths.dir) + ' | claves: ' + keysDir());
  });
  app.on('before-quit', () => stopBridge());
  app.on('window-all-closed', () => app.quit());
}
