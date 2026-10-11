// RomFS del juego (exefs\romfs.bin de la version exportada): agregar archivos sueltos sin reconstruir los 10 GB.
// La version exportada no aplica los mods de romfs (LayeredFS), asi que los iconos de botones se meten
// directamente en romfs.bin como archivos sueltos en /ui (el juego los prefiere sobre los de ui.pkz).
//
// Como se hace sin riesgo:
//   - Los datos nuevos y una copia nueva de las tablas se escriben DESPUES del final actual del archivo.
//   - Solo se cambia la cabecera (80 bytes) para que apunte a las tablas nuevas.
//   - Los datos y tablas originales no se tocan: deshacer = volver a poner la cabecera original y recortar
//     el archivo a su tamano original (ver restore()).
const fs = require('fs');

const NONE = 0xFFFFFFFF;
const align = (n, a) => Math.ceil(n / a) * a;

function readAt(fd, pos, len) { const b = Buffer.alloc(len); let o = 0; while (o < len) { const r = fs.readSync(fd, b, o, len - o, pos + o); if (r <= 0) throw new Error('lectura corta'); o += r; } return b; }
function writeAt(fd, pos, buf) { let o = 0; while (o < buf.length) { o += fs.writeSync(fd, buf, o, buf.length - o, pos + o); } }

function readHeader(fd) {
  const h = readAt(fd, 0, 0x50);
  const q = (i) => Number(h.readBigUInt64LE(i * 8));
  const H = { raw: h, size: q(0), dirHashOff: q(1), dirHashSize: q(2), dirMetaOff: q(3), dirMetaSize: q(4), fileHashOff: q(5), fileHashSize: q(6), fileMetaOff: q(7), fileMetaSize: q(8), dataOff: q(9) };
  if (H.size !== 0x50) throw new Error('romfs.bin: cabecera desconocida');
  return H;
}

// hash de nombres del RomFS de Switch
function nameHash(parent, name) {
  let h = (parent ^ 123456789) >>> 0;
  for (const c of Buffer.from(name, 'utf8')) { h = ((h >>> 5) | (h << 27)) >>> 0; h = (h ^ c) >>> 0; }
  return h;
}

function load(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const H = readHeader(fd);
    const T = {
      H,
      dirHash: readAt(fd, H.dirHashOff, H.dirHashSize),
      dirMeta: readAt(fd, H.dirMetaOff, H.dirMetaSize),
      fileHash: readAt(fd, H.fileHashOff, H.fileHashSize),
      fileMeta: readAt(fd, H.fileMetaOff, H.fileMetaSize),
      fileSize: fs.fstatSync(fd).size
    };
    return T;
  } finally { fs.closeSync(fd); }
}
const dirAt = (T, o) => ({ parent: T.dirMeta.readUInt32LE(o), sibling: T.dirMeta.readUInt32LE(o + 4), childDir: T.dirMeta.readUInt32LE(o + 8), childFile: T.dirMeta.readUInt32LE(o + 12), name: T.dirMeta.toString('utf8', o + 24, o + 24 + T.dirMeta.readUInt32LE(o + 20)) });
const fileAt = (T, o) => ({ parent: T.fileMeta.readUInt32LE(o), sibling: T.fileMeta.readUInt32LE(o + 4), off: Number(T.fileMeta.readBigUInt64LE(o + 8)), size: Number(T.fileMeta.readBigUInt64LE(o + 16)), name: T.fileMeta.toString('utf8', o + 32, o + 32 + T.fileMeta.readUInt32LE(o + 28)) });

function findDir(T, p) {
  let cur = 0;
  for (const part of p.split('/').filter(Boolean)) {
    let c = dirAt(T, cur).childDir, hit = NONE;
    while (c !== NONE) { const d = dirAt(T, c); if (d.name === part) { hit = c; break; } c = d.sibling; }
    if (hit === NONE) return NONE;
    cur = hit;
  }
  return cur;
}
// archivos de una carpeta: { nombre: { entry, off (absoluto en romfs.bin), size } }
function listFiles(T, dirOff) {
  const out = {};
  let c = dirAt(T, dirOff).childFile;
  while (c !== NONE) { const f = fileAt(T, c); out[f.name] = { entry: c, abs: T.H.dataOff + f.off, size: f.size }; c = f.sibling; }
  return out;
}

// Agrega (o reemplaza el contenido, si ya fueron agregados antes con el mismo tamano) archivos sueltos en una carpeta.
// files: [{ name, data: Buffer }]. Devuelve { name: posicion absoluta del contenido }.
function addFiles(file, dirPath, files, log) {
  const T = load(file);
  const dirOff = findDir(T, dirPath);
  if (dirOff === NONE) throw new Error('romfs.bin: no existe la carpeta ' + dirPath);
  const have = listFiles(T, dirOff);
  const pos = {};
  // ya estan (de una vez anterior) y caben: solo se reescribe el contenido
  if (files.every((f) => have[f.name] && have[f.name].size === f.data.length)) {
    const fd = fs.openSync(file, 'r+');
    try { for (const f of files) { writeAt(fd, have[f.name].abs, f.data); pos[f.name] = have[f.name].abs; } } finally { fs.closeSync(fd); }
    return { pos, added: false };
  }
  if (files.some((f) => have[f.name])) throw new Error('romfs.bin: ' + dirPath + ' ya tiene archivos con esos nombres y otro tamano');

  // tablas nuevas = copia de las actuales + entradas nuevas
  let fileMeta = Buffer.from(T.fileMeta);
  const dirMeta = Buffer.from(T.dirMeta), fileHash = Buffer.from(T.fileHash);
  const buckets = fileHash.length / 4;
  let dataPos = align(T.fileSize, 0x10);
  const entries = [];
  for (const f of files) {
    const nameB = Buffer.from(f.name, 'utf8');
    const e = Buffer.alloc(align(32 + nameB.length, 4));
    const eOff = fileMeta.length;
    const firstChild = dirMeta.readUInt32LE(dirOff + 12);
    e.writeUInt32LE(dirOff, 0);                       // carpeta
    e.writeUInt32LE(firstChild, 4);                   // hermano = el que era el primero
    e.writeBigUInt64LE(BigInt(dataPos - T.H.dataOff), 8);
    e.writeBigUInt64LE(BigInt(f.data.length), 16);
    const b = nameHash(dirOff, f.name) % buckets;
    e.writeUInt32LE(fileHash.readUInt32LE(b * 4), 24); // siguiente en la cubeta
    e.writeUInt32LE(nameB.length, 28);
    nameB.copy(e, 32);
    fileHash.writeUInt32LE(eOff, b * 4);
    dirMeta.writeUInt32LE(eOff, dirOff + 12);
    fileMeta = Buffer.concat([fileMeta, e]);
    entries.push({ f, dataPos });
    pos[f.name] = dataPos;
    dataPos = align(dataPos + f.data.length, 0x10);
  }
  // disposicion al final del archivo: [datos nuevos][hash dirs][dirs][hash archivos][archivos]
  const L = {};
  L.dirHashOff = align(dataPos, 4);
  L.dirMetaOff = L.dirHashOff + T.dirHash.length;
  L.fileHashOff = L.dirMetaOff + dirMeta.length;
  L.fileMetaOff = L.fileHashOff + fileHash.length;
  const end = L.fileMetaOff + fileMeta.length;
  const H = Buffer.from(T.H.raw);
  const put = (i, v) => H.writeBigUInt64LE(BigInt(v), i * 8);
  put(1, L.dirHashOff); put(2, T.dirHash.length); put(3, L.dirMetaOff); put(4, dirMeta.length);
  put(5, L.fileHashOff); put(6, fileHash.length); put(7, L.fileMetaOff); put(8, fileMeta.length);

  const fd = fs.openSync(file, 'r+');
  try {
    for (const { f, dataPos: p } of entries) writeAt(fd, p, f.data);
    writeAt(fd, L.dirHashOff, T.dirHash);
    writeAt(fd, L.dirMetaOff, dirMeta);
    writeAt(fd, L.fileHashOff, fileHash);
    writeAt(fd, L.fileMetaOff, fileMeta);
    fs.fsyncSync(fd);
    writeAt(fd, 0, H);                               // al final: la cabecera apunta a lo nuevo
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (log) log('romfs.bin: ' + files.length + ' archivos agregados en ' + dirPath + ' (' + T.fileSize + ' -> ' + end + ' bytes)');
  return { pos, added: true, original: { header: T.H.raw.toString('base64'), size: T.fileSize } };
}

// deshacer: cabecera original + tamano original
function restore(file, original) {
  const fd = fs.openSync(file, 'r+');
  try { writeAt(fd, 0, Buffer.from(original.header, 'base64')); fs.ftruncateSync(fd, original.size); } finally { fs.closeSync(fd); }
}

module.exports = { load, findDir, listFiles, addFiles, restore, nameHash, readHeader };
