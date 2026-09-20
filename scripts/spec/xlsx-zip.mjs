// sp4sap:program-to-spec — Shared zero-dep ZIP read/write for xlsx files.
//
// Extracted from template-clone.mjs so both template-clone.mjs (sharedStrings
// translation) and image-swap.mjs (media swap) operate on the same code path.
// Single source of truth — keeps both helpers byte-compatible.
//
// Scope: just enough ZIP to read/write the small xlsx files produced by the
// program-to-spec pipeline (≤ 1 MB, no ZIP64, no encryption, no spanning).

import { deflateRawSync, inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

export function unzipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('xlsx-zip: EOCD not found');
  const cdEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lfhOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(lfhOffset + 26);
    const lExtraLen = buf.readUInt16LE(lfhOffset + 28);
    const dataStart = lfhOffset + 30 + lNameLen + lExtraLen;
    const compData = buf.slice(dataStart, dataStart + compSize);
    const data = method === 0 ? compData : inflateRawSync(compData);
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function zipFiles(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const compressed = deflateRawSync(raw, { level: 9 });
    const useDeflate = compressed.length < raw.length;
    const body = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(method),
      u16(0), u16(0), u32(crc), u32(body.length), u32(raw.length),
      u16(nameBuf.length), u16(0), nameBuf,
    ]);
    locals.push(local, body);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method),
      u16(0), u16(0), u32(crc), u32(body.length), u32(raw.length),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBuf,
    ]);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const centralSize = centrals.reduce((s, p) => s + p.length, 0);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(centralSize), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, ...centrals, eocd]);
}
