'use strict';

// 사용자가 추가한 글꼴: <userData>/fonts 에 저장해 다음에 실행할 때도 쓴다.
// 윈도우·맥·우분투 글꼴 폴더에서 쓰는 형식(TTF, OTF, TTC)과 WOFF 를 받는다.
// TTC(글꼴 모음: 바탕·굴림, Apple SD Gothic Neo, Noto CJK 등)는 글꼴 하나씩 떼어 내 고르게 한다.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_SIZE = 80 * 1024 * 1024;

function detect(buf) {
  if (buf.length < 12) return null;
  const magic = buf.subarray(0, 4).toString('latin1');
  if (magic === 'wOF2') return 'woff2';
  if (magic === 'wOFF') return 'woff';
  if (magic === 'OTTO') return 'otf';
  if (magic === 'ttcf') return 'ttc';
  if (magic === 'true' || buf.readUInt32BE(0) === 0x00010000) return 'ttf';
  return null;
}

/** TTC 의 i 번째 글꼴을 독립된 TTF/OTF 파일로 (표는 그대로 복사, 오프셋만 새로) */
function extractFace(buf, offset) {
  const sfntVersion = buf.readUInt32BE(offset);
  const numTables = buf.readUInt16BE(offset + 4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + i * 16;
    tables.push({
      tag: buf.subarray(rec, rec + 4),
      checksum: buf.readUInt32BE(rec + 4),
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12),
    });
  }
  const headerLen = 12 + 16 * numTables;
  const size = tables.reduce((n, t) => n + ((t.length + 3) & ~3), headerLen);
  const out = Buffer.alloc(size);
  out.writeUInt32BE(sfntVersion, 0);
  out.writeUInt16BE(numTables, 4);
  let pow = 1;
  let log = 0;
  while (pow * 2 <= numTables) {
    pow *= 2;
    log += 1;
  }
  out.writeUInt16BE(pow * 16, 6);
  out.writeUInt16BE(log, 8);
  out.writeUInt16BE(numTables * 16 - pow * 16, 10);
  let pos = headerLen;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    t.tag.copy(out, rec);
    out.writeUInt32BE(t.checksum, rec + 4);
    out.writeUInt32BE(pos, rec + 8);
    out.writeUInt32BE(t.length, rec + 12);
    buf.copy(out, pos, t.offset, t.offset + t.length);
    pos += (t.length + 3) & ~3;
  });
  return { data: out, kind: sfntVersion === 0x4f54544f ? 'otf' : 'ttf' };
}

// ---------------------------------------------------------------------------
// 화면(Chromium)용 손질: 표 목록 머리 값이 틀렸거나 OS/2 표가 없는 오래된 글꼴(일부 맥 기본 글꼴 등)은
// 브라우저 글꼴 검사기(OTS)가 거부하므로, 표 목록을 다시 쓰고 OS/2 표를 글꼴 자체 값으로 만들어 넣는다.
// ---------------------------------------------------------------------------

function checksum(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = ((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0;
    sum = (sum + v) >>> 0;
  }
  return sum;
}

function readTables(buf) {
  const n = buf.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    const offset = buf.readUInt32BE(rec + 8);
    const length = buf.readUInt32BE(rec + 12);
    tables.push({ tag: buf.toString('latin1', rec, rec + 4), checksum: buf.readUInt32BE(rec + 4), data: buf.subarray(offset, offset + length) });
  }
  return tables;
}

function buildSfnt(sfntVersion, tables) {
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = tables.length;
  const headerLen = 12 + 16 * n;
  const out = Buffer.alloc(tables.reduce((size, t) => size + ((t.data.length + 3) & ~3), headerLen));
  out.writeUInt32BE(sfntVersion, 0);
  out.writeUInt16BE(n, 4);
  let pow = 1;
  let log = 0;
  while (pow * 2 <= n) {
    pow *= 2;
    log += 1;
  }
  out.writeUInt16BE(pow * 16, 6);
  out.writeUInt16BE(log, 8);
  out.writeUInt16BE(n * 16 - pow * 16, 10);
  let pos = headerLen;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    out.write(t.tag, rec, 4, 'latin1');
    out.writeUInt32BE(t.checksum, rec + 4);
    out.writeUInt32BE(pos, rec + 8);
    out.writeUInt32BE(t.data.length, rec + 12);
    t.data.copy(out, pos);
    pos += (t.data.length + 3) & ~3;
  });
  return out;
}

function synthesizeOS2(tables) {
  const head = tables.find((t) => t.tag === 'head')?.data;
  const hhea = tables.find((t) => t.tag === 'hhea')?.data;
  if (!head || head.length < 54 || !hhea || hhea.length < 36) return null;
  const upm = head.readUInt16BE(18) || 1000;
  const bold = (head.readUInt16BE(44) & 1) === 1;
  const asc = hhea.readInt16BE(4);
  const desc = hhea.readInt16BE(6);
  const gap = hhea.readInt16BE(8);
  const os2 = Buffer.alloc(96);
  const i16 = (off, v) => os2.writeInt16BE(Math.max(-32768, Math.min(32767, Math.round(v))), off);
  os2.writeUInt16BE(4, 0); // version
  i16(2, upm / 2); // xAvgCharWidth
  os2.writeUInt16BE(bold ? 700 : 400, 4);
  os2.writeUInt16BE(5, 6); // usWidthClass: normal
  os2.writeUInt16BE(0, 8); // fsType: installable
  i16(10, upm * 0.65); // subscript
  i16(12, upm * 0.6);
  i16(14, 0);
  i16(16, upm * 0.075);
  i16(18, upm * 0.65); // superscript
  i16(20, upm * 0.6);
  i16(22, 0);
  i16(24, upm * 0.35);
  i16(26, upm * 0.05); // strikeout
  i16(28, upm * 0.3);
  os2.writeUInt32BE(1, 42); // ulUnicodeRange1: Basic Latin
  os2.writeUInt32BE(1 << 24, 46); // ulUnicodeRange2 bit 56: Hangul syllables
  os2.write('    ', 58, 4, 'latin1'); // achVendID
  os2.writeUInt16BE(bold ? 0x20 : 0x40, 62); // fsSelection
  os2.writeUInt16BE(0x20, 64);
  os2.writeUInt16BE(0xffff, 66);
  i16(68, asc); // sTypoAscender / Descender / LineGap
  i16(70, desc);
  i16(72, gap);
  os2.writeUInt16BE(Math.max(0, Math.min(65535, asc)), 74); // usWinAscent / Descent
  os2.writeUInt16BE(Math.max(0, Math.min(65535, -desc)), 76);
  i16(86, upm * 0.5); // sxHeight
  i16(88, upm * 0.7); // sCapHeight
  os2.writeUInt16BE(32, 92); // usBreakChar
  return os2;
}

function repairForWeb(face) {
  if (face.kind === 'woff') return face;
  const buf = face.data;
  const n = buf.readUInt16BE(4);
  let pow = 1;
  while (pow * 2 <= n) pow *= 2;
  let changed = buf.readUInt16BE(6) !== pow * 16 || buf.readUInt16BE(10) !== n * 16 - pow * 16;
  let tables = readTables(buf);
  // 세로쓰기 표의 버전이 틀린 글꼴(일부 맥 기본 글꼴)은 검사기가 통째로 거부하므로 세로 표를 뺀다 (가로쓰기에는 쓰지 않음)
  const vhea = tables.find((t) => t.tag === 'vhea');
  const vheaOk = !vhea || (vhea.data.length >= 4 && [0x00010000, 0x00011000].includes(vhea.data.readUInt32BE(0)));
  const drop = new Set(['hdmx', ...(vheaOk ? [] : ['vhea', 'vmtx'])]);
  if (tables.some((t) => drop.has(t.tag))) {
    tables = tables.filter((t) => !drop.has(t.tag));
    changed = true;
  }
  if (!tables.some((t) => t.tag === 'OS/2')) {
    const os2 = synthesizeOS2(tables);
    if (os2) {
      tables.push({ tag: 'OS/2', checksum: checksum(os2), data: os2 });
      changed = true;
    }
  }
  return changed ? { data: buildSfnt(buf.readUInt32BE(0), tables), kind: face.kind } : face;
}

function createFontStore(app, T) {
  const dir = () => path.join(app.getPath('userData'), 'fonts');
  const indexFile = () => path.join(dir(), 'fonts.json');
  const readIndex = () => {
    try {
      const list = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (list) => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(indexFile(), JSON.stringify(list, null, 2));
  };

  return {
    /** 형식 확인. 글꼴 모음(TTC)이면 글꼴마다 떼어 낸 목록을 돌려준다 (화면에서 고르고 검사한 뒤 save). */
    async normalize(data) {
      if (!(data instanceof Uint8Array)) throw new Error(T('err.fontFormat'));
      if (data.byteLength > MAX_SIZE) throw new Error(T('err.fontTooLarge'));
      const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const kind = detect(buf);
      if (!kind || kind === 'woff2') throw new Error(T('err.fontFormat'));
      if (kind === 'ttc') {
        const count = buf.readUInt32BE(8);
        const faces = [];
        for (let i = 0; i < Math.min(count, 64); i++) {
          try {
            faces.push(extractFace(buf, buf.readUInt32BE(12 + i * 4)));
          } catch {
            /* 읽을 수 없는 글꼴은 건너뛴다 */
          }
        }
        if (!faces.length) throw new Error(T('err.fontFormat'));
        return faces.map(repairForWeb);
      }
      return [repairForWeb({ data: buf, kind })];
    },

    async list() {
      const out = [];
      for (const entry of readIndex()) {
        try {
          out.push({ id: entry.id, name: entry.name, data: await fsp.readFile(path.join(dir(), entry.file)) });
        } catch {
          /* 파일이 없어졌으면 건너뛴다 */
        }
      }
      return out;
    },

    async save({ name, kind, data }) {
      if (!(data instanceof Uint8Array)) throw new Error(T('err.fontFormat'));
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const ext = ['ttf', 'otf', 'woff'].includes(kind) ? kind : 'ttf';
      const file = `${id}.${ext}`;
      await fsp.mkdir(dir(), { recursive: true });
      await fsp.writeFile(path.join(dir(), file), Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      const list = readIndex();
      list.push({ id, name: String(name || id).slice(0, 120), file });
      writeIndex(list);
      return { id };
    },

    async remove(id) {
      const list = readIndex();
      const entry = list.find((e) => e.id === id);
      if (!entry) return;
      await fsp.rm(path.join(dir(), entry.file), { force: true });
      writeIndex(list.filter((e) => e.id !== id));
    },
  };
}

module.exports = { createFontStore };
