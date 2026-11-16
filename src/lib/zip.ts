/**
 * 아주 작은 ZIP 작성기. PNG·JPG 는 이미 압축되어 있으므로 압축 없이(stored) 담는다.
 * 항목을 넣을 때마다 바로 sink 로 내보내므로 큰 문서도 전체를 메모리에 들고 있지 않는다.
 * 파일 이름은 UTF-8 표시(비트 11)를 켜서 한글 이름도 윈도우·맥·리눅스에서 그대로 보인다.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date) {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const UTF8_FLAG = 0x0800;
const MAX_U32 = 0xffffffff;

interface Entry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export class ZipTooLargeError extends Error {
  constructor() {
    super('ZIP 파일이 너무 큽니다 (4GB 또는 65535개 초과)');
  }
}

export class ZipWriter {
  private entries: Entry[] = [];
  private names = new Set<string>();
  private offset = 0;
  private readonly sink: (chunks: Uint8Array[]) => Promise<void>;

  constructor(sink: (chunks: Uint8Array[]) => Promise<void>) {
    this.sink = sink;
  }

  async add(name: string, data: Uint8Array, when = new Date()): Promise<void> {
    if (this.names.has(name)) throw new Error(`duplicate zip entry: ${name}`);
    const nameBytes = new TextEncoder().encode(name);
    if (this.entries.length >= 0xffff || this.offset + 30 + nameBytes.length + data.length > MAX_U32) throw new ZipTooLargeError();
    this.names.add(name);
    const { time, date } = dosDateTime(when);
    const crc = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true); // 지역 파일 머리
    v.setUint16(4, 20, true); // 필요한 버전 2.0
    v.setUint16(6, UTF8_FLAG, true);
    v.setUint16(8, 0, true); // 압축 없음
    v.setUint16(10, time, true);
    v.setUint16(12, date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    this.entries.push({ name: nameBytes, crc, size: data.length, offset: this.offset, time, date });
    this.offset += header.length + data.length;
    await this.sink([header, data]);
  }

  /** 중앙 디렉터리와 끝 표시를 써서 ZIP 을 마무리한다 */
  async finish(): Promise<void> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (const e of this.entries) {
      const h = new Uint8Array(46 + e.name.length);
      const v = new DataView(h.buffer);
      v.setUint32(0, 0x02014b50, true); // 중앙 디렉터리 머리
      v.setUint16(4, 20, true); // 만든 버전 2.0 (MS-DOS)
      v.setUint16(6, 20, true);
      v.setUint16(8, UTF8_FLAG, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, e.time, true);
      v.setUint16(14, e.date, true);
      v.setUint32(16, e.crc, true);
      v.setUint32(20, e.size, true);
      v.setUint32(24, e.size, true);
      v.setUint16(28, e.name.length, true);
      // 30: 추가 필드 길이, 32: 설명 길이, 34: 디스크 번호, 36: 내부 속성, 38: 외부 속성 — 모두 0
      v.setUint32(42, e.offset, true);
      h.set(e.name, 46);
      chunks.push(h);
      size += h.length;
    }
    if (this.offset + size + 22 > MAX_U32) throw new ZipTooLargeError();
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true); // 끝 표시
    v.setUint16(8, this.entries.length, true);
    v.setUint16(10, this.entries.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, this.offset, true);
    chunks.push(end);
    await this.sink(chunks);
  }
}
