// Archivos de la interfaz del juego que el launcher necesita para los iconos de botones.
// No se distribuyen con el launcher: se sacan del romfs.bin del propio usuario (su juego exportado).
//   - ui_core.dtt / ui_core_es.dtt / ui_core_us.dtt (contienen el atlas de iconos de botones)
//   - base_atlas.rgba: el atlas original del juego (256x512) para dibujar las vistas previas del launcher
// Si ui.pkz ya fue parcheado antes, se usan los respaldos originales (data/ui_pkz_original).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const R = require('./romfs');
const P = require('./pkz');

const ATLAS = { w: 256, h: 512, bh: 16, size: 0x80000 };

function readAt(fd, pos, len) { const b = Buffer.alloc(len); let o = 0; while (o < len) { const r = fs.readSync(fd, b, o, len - o, pos + o); if (r <= 0) throw new Error('lectura corta'); o += r; } return b; }

function unzstd(buf, size) {
  if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('esta version de Electron no trae zstd');
  const out = zlib.zstdDecompressSync(buf);
  if (size && out.length !== size) throw new Error('tamano inesperado al descomprimir');
  return out;
}

// copia los ui_core*.dtt originales a outDir; devuelve la lista de archivos escritos
function extractOriginals(romfsFile, outDir, backupDir, names) {
  const T = R.load(romfsFile), ui = R.findDir(T, 'ui');
  if (ui === 0xFFFFFFFF) throw new Error('romfs.bin sin carpeta /ui');
  const pk = R.listFiles(T, ui)['ui.pkz'];
  if (!pk) throw new Error('romfs.bin sin /ui/ui.pkz');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(backupDir, 'pkz_original.json'), 'utf8')); } catch (e) {}
  fs.mkdirSync(outDir, { recursive: true });
  const fd = fs.openSync(romfsFile, 'r');
  const done = [];
  try {
    const list = P.entries(fd, pk.abs, pk.size);
    for (const name of names) {
      const e = list.find((x) => x.name === name);
      if (!e) continue;
      let comp;
      const m = meta[name], blob = path.join(backupDir, name + '.zst');
      if (m && fs.existsSync(blob)) comp = fs.readFileSync(blob).subarray(0, m.csize);   // original de antes del parche
      else comp = readAt(fd, e.abs, e.csize);
      fs.writeFileSync(path.join(outDir, name), unzstd(comp, e.size));
      done.push(name);
    }
  } finally { fs.closeSync(fd); }
  return done;
}

// posicion de core.wtp (el atlas es su primera textura) dentro del .dtt
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

// block-linear (Tegra) -> lineal
function deswizzleAtlas(sw) {
  const wb = ATLAS.w * 4, gobsW = wb / 64, out = Buffer.alloc(ATLAS.w * ATLAS.h * 4);
  for (let y = 0; y < ATLAS.h; y++) {
    const gy = Math.floor(y / (8 * ATLAS.bh)) * (512 * ATLAS.bh * gobsW) + Math.floor((y % (8 * ATLAS.bh)) / 8) * 512, yi = y % 8;
    for (let x = 0; x < wb; x += 16) {
      const xi = x % 64, a = gy + Math.floor(x / 64) * (512 * ATLAS.bh) + Math.floor(xi / 32) * 256 + Math.floor(yi / 2) * 64 + Math.floor((xi % 32) / 16) * 32 + (yi % 2) * 16;
      sw.copy(out, y * wb + x, a, a + 16);
    }
  }
  return out;
}

// atlas original en un formato que el launcher puede mostrar: blanco con el alfa del juego (forma del icono)
function writeBaseAtlas(dttFile, outFile) {
  const buf = fs.readFileSync(dttFile), off = atlasOffset(buf);
  if (off < 0) throw new Error('no se encontro el atlas en ' + path.basename(dttFile));
  const lin = deswizzleAtlas(buf.subarray(off, off + ATLAS.size));
  for (let i = 0; i < lin.length; i += 4) { lin[i] = 255; lin[i + 1] = 255; lin[i + 2] = 255; }
  fs.writeFileSync(outFile, lin);
}

module.exports = { extractOriginals, writeBaseAtlas, atlasOffset, deswizzleAtlas, ATLAS };
