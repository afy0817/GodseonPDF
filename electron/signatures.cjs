'use strict';

// 서명 서랍: 직접 그린 서명(투명 PNG)을 <userData>/signatures 에 저장해 다음에 실행할 때도 쓴다.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_SIZE = 16 * 1024 * 1024;
const MAX_COUNT = 200;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createSignatureStore(app, T) {
  const dir = () => path.join(app.getPath('userData'), 'signatures');
  const indexFile = () => path.join(dir(), 'signatures.json');
  const readIndex = () => {
    try {
      const list = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
      return Array.isArray(list) ? list.filter((e) => e && typeof e.id === 'string' && typeof e.file === 'string') : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (list) => {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = `${indexFile()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, indexFile());
  };

  return {
    /** 새로 만든 것부터 */
    async list() {
      const out = [];
      for (const entry of readIndex()) {
        try {
          const data = await fsp.readFile(path.join(dir(), path.basename(entry.file)));
          out.push({ id: entry.id, name: String(entry.name ?? ''), data });
        } catch {
          /* 파일이 없어졌으면 건너뛴다 */
        }
      }
      return out;
    },

    async save({ name, data }) {
      if (!(data instanceof Uint8Array) || data.byteLength < 8 || data.byteLength > MAX_SIZE) throw new Error(T('err.badData'));
      const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      if (!buf.subarray(0, 8).equals(PNG_MAGIC)) throw new Error(T('err.badData'));
      const list = readIndex();
      if (list.length >= MAX_COUNT) throw new Error(T('err.tooManySignatures', { n: MAX_COUNT }));
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const file = `${id}.png`;
      await fsp.mkdir(dir(), { recursive: true });
      await fsp.writeFile(path.join(dir(), file), buf);
      list.unshift({ id, name: String(name || '').slice(0, 120), file, created: new Date().toISOString() });
      writeIndex(list);
      return { id };
    },

    async remove(id) {
      const list = readIndex();
      const entry = list.find((e) => e.id === id);
      if (!entry) return;
      await fsp.rm(path.join(dir(), path.basename(entry.file)), { force: true });
      writeIndex(list.filter((e) => e.id !== id));
    },
  };
}

module.exports = { createSignatureStore };
