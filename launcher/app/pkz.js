// Archivos .pkz de Astral Chain (dentro de romfs.bin): cabecera 'pkzl' + tabla de entradas
// { nombre, tamano, posicion, tamano comprimido } y cada archivo comprimido con zstd.
// La version exportada no aplica mods de romfs, asi que los ui_core*.dtt con los iconos nuevos se
// recomprimen y se escriben EN SU MISMO HUECO dentro de ui.pkz (zstd nivel 19 queda mas chico que el
// original). Nada cambia de tamano ni de lugar; el contenido original se guarda para poder deshacerlo.
const fs = require('fs');
const zlib = require('zlib');

function readAt(fd, pos, len) { const b = Buffer.alloc(len); let o = 0; while (o < len) { const r = fs.readSync(fd, b, o, len - o, pos + o); if (r <= 0) throw new Error('lectura corta'); o += r; } return b; }
function writeAt(fd, pos, buf) { let o = 0; while (o < buf.length) o += fs.writeSync(fd, buf, o, buf.length - o, pos + o); }

// entradas del pkz que empieza en 'base' (posicion absoluta en el archivo)
function entries(fd, base, pkzSize) {
  const h = readAt(fd, base, 0x20);
  if (h.toString('latin1', 0, 4) !== 'pkzl') throw new Error('no es un pkz');
  const n = h.readUInt32LE(0x10), eo = h.readUInt32LE(0x14), ns = h.readUInt32LE(0x18);
  const tab = readAt(fd, base + eo, n * 0x20 + ns), nb = n * 0x20;
  const list = [];
  for (let i = 0; i < n; i++) {
    const p = i * 0x20, no = Number(tab.readBigUInt64LE(p));
    const name = tab.toString('latin1', nb + no, tab.indexOf(0, nb + no));
    list.push({ i, name, size: Number(tab.readBigUInt64LE(p + 8)), off: Number(tab.readBigUInt64LE(p + 16)), csize: Number(tab.readBigUInt64LE(p + 24)), entryPos: base + eo + p });
  }
  // hueco disponible = hasta el siguiente archivo
  const offs = list.map((e) => e.off).sort((a, b) => a - b);
  for (const e of list) { const nx = offs.find((o) => o > e.off); e.cap = (nx === undefined ? pkzSize : nx) - e.off; e.abs = base + e.off; }
  return list;
}

const zstdLevel = 19;
function compress(buf) {
  return new Promise((res, rej) => {
    if (typeof zlib.zstdCompress !== 'function') return rej(new Error('esta version de Electron no trae zstd'));
    const C = zlib.constants;
    zlib.zstdCompress(buf, { params: { [C.ZSTD_c_compressionLevel]: zstdLevel, [C.ZSTD_c_windowLog]: 20, [C.ZSTD_c_checksumFlag]: 0, [C.ZSTD_c_contentSizeFlag]: 1 } },
      (err, out) => (err ? rej(err) : res(out)));
  });
}

// Reemplaza archivos dentro del pkz. files: [{ name, data }]. backupDir: donde guardar los originales (solo la 1a vez).
// Devuelve la lista de lo escrito. Si algo no cabe, no escribe nada.
async function replace(file, base, pkzSize, files, backupDir, log) {
  let fd = fs.openSync(file, 'r');
  let list;
  try { list = entries(fd, base, pkzSize); } finally { fs.closeSync(fd); }
  const plan = [];
  for (const f of files) {
    const e = list.find((x) => x.name === f.name);
    if (!e) throw new Error(f.name + ' no esta en el pkz');
    if (e.size !== f.data.length) throw new Error(f.name + ': tamano distinto al original');
    const z = await compress(f.data);
    if (z.length > e.cap) throw new Error(f.name + ': comprimido no cabe (' + z.length + ' > ' + e.cap + ')');
    // comprobacion: se descomprime igual
    if (typeof zlib.zstdDecompressSync === 'function' && !zlib.zstdDecompressSync(z).equals(f.data)) throw new Error(f.name + ': zstd no coincide');
    plan.push({ e, z });
  }
  // respaldo de los originales (hueco completo + campo de tamano comprimido)
  if (backupDir) {
    fs.mkdirSync(backupDir, { recursive: true });
    const idx = require('path').join(backupDir, 'pkz_original.json');
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(idx, 'utf8')); } catch (e) {}
    fd = fs.openSync(file, 'r');
    try {
      for (const { e } of plan) {
        if (meta[e.name]) continue;
        const blob = require('path').join(backupDir, e.name + '.zst');
        fs.writeFileSync(blob, readAt(fd, e.abs, e.cap));
        meta[e.name] = { file, abs: e.abs, cap: e.cap, entryPos: e.entryPos, csize: e.csize, blob };
      }
    } finally { fs.closeSync(fd); }
    fs.writeFileSync(idx, JSON.stringify(meta, null, 1));
  }
  fd = fs.openSync(file, 'r+');
  try {
    for (const { e, z } of plan) {
      const slot = Buffer.alloc(e.cap); z.copy(slot);
      writeAt(fd, e.abs, slot);
      const cs = Buffer.alloc(8); cs.writeBigUInt64LE(BigInt(z.length));
      writeAt(fd, e.entryPos + 24, cs);
    }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (log) log('ui.pkz: ' + plan.map(({ e, z }) => e.name + ' ' + z.length + '/' + e.cap).join(', '));
  return plan.map(({ e }) => e.name);
}

// deshacer con los respaldos
// file: romfs.bin actual (las rutas guardadas pueden ser de otra ubicacion si se movio la carpeta)
function restore(backupDir, file) {
  const P = require('path'), idx = P.join(backupDir, 'pkz_original.json');
  const meta = JSON.parse(fs.readFileSync(idx, 'utf8'));
  for (const [name, m] of Object.entries(meta)) {
    const fd = fs.openSync(file || m.file, 'r+');
    try {
      writeAt(fd, m.abs, fs.readFileSync(P.join(backupDir, name + '.zst')));
      const cs = Buffer.alloc(8); cs.writeBigUInt64LE(BigInt(m.csize)); writeAt(fd, m.entryPos + 24, cs);
    } finally { fs.closeSync(fd); }
  }
}

module.exports = { entries, replace, restore, compress };
