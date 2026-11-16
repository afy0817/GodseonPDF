import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  type PDFDocument,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { Encodings, Font, type IFontNames } from '@cantoo/pdf-lib/standard-fonts';

/**
 * 페이지 내용 스트림에서 '사각형 안에 완전히 들어가는' 글자 그리기 명령(Tj/TJ)을 지운다.
 *
 * - 지운 명령 자리에는 같은 폭만큼 커서를 옮기는 [n] TJ 를 넣어, 뒤따르는 글자 위치가 바뀌지 않게 한다.
 * - 글자 폭을 정확히 알 수 없는 경우(폭 정보가 없는 글꼴, Identity 가 아닌 CID 인코딩, Type3 등)나
 *   일부만 사각형에 걸친 명령은 지우지 않는다 (덮개로 가리기만 한다).
 * - 지우는 것 외에는 원래 바이트를 그대로 둔다. 해석 중 문제가 생기면 그 페이지는 손대지 않는다.
 */

export interface UserRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Matrix = [number, number, number, number, number, number];
type Operand = number | string | Uint8Array | boolean | null | Operand[] | { [k: string]: Operand };

interface Op {
  op: string;
  args: Operand[];
  start: number;
  end: number;
}

class Name {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}

// ---------------------------------------------------------------------------
// 토큰 읽기
// ---------------------------------------------------------------------------

const isWs = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

class Lexer {
  pos = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }

  skipWs() {
    const { b } = this;
    for (;;) {
      while (this.pos < b.length && isWs(b[this.pos])) this.pos++;
      if (b[this.pos] === 37) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
        continue;
      }
      return;
    }
  }

  /** 다음 값(피연산자) 또는 키워드(연산자) */
  read(): { kw?: string; value?: Operand } {
    const { b } = this;
    const c = b[this.pos];
    if (c === 91) {
      this.pos++;
      const arr: Operand[] = [];
      for (;;) {
        this.skipWs();
        if (this.pos >= b.length) throw new Error('배열이 끝나지 않음');
        if (b[this.pos] === 93) {
          this.pos++;
          return { value: arr };
        }
        const t = this.read();
        if (t.kw !== undefined) throw new Error('배열 안의 연산자');
        arr.push(t.value!);
      }
    }
    if (c === 60 && b[this.pos + 1] === 60) {
      this.pos += 2;
      const dict: { [k: string]: Operand } = {};
      for (;;) {
        this.skipWs();
        if (this.pos >= b.length) throw new Error('사전이 끝나지 않음');
        if (b[this.pos] === 62 && b[this.pos + 1] === 62) {
          this.pos += 2;
          return { value: dict };
        }
        const k = this.read();
        this.skipWs();
        const v = this.read();
        if (!(k.value instanceof Name) || v.kw !== undefined) throw new Error('잘못된 사전');
        dict[k.value.name] = v.value!;
      }
    }
    if (c === 60) return { value: this.hexString() };
    if (c === 40) return { value: this.literalString() };
    if (c === 47) {
      this.pos++;
      const s = this.pos;
      while (this.pos < b.length && !isWs(b[this.pos]) && !isDelim(b[this.pos])) this.pos++;
      return { value: new Name(String.fromCharCode(...b.subarray(s, this.pos))) as unknown as Operand };
    }
    if (c === 43 || c === 45 || c === 46 || (c >= 48 && c <= 57)) {
      const s = this.pos;
      this.pos++;
      while (this.pos < b.length && (b[this.pos] === 46 || (b[this.pos] >= 48 && b[this.pos] <= 57))) this.pos++;
      const n = Number(String.fromCharCode(...b.subarray(s, this.pos)));
      return { value: Number.isFinite(n) ? n : 0 };
    }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) throw new Error('예상하지 못한 구분자');
    const s = this.pos;
    while (this.pos < b.length && !isWs(b[this.pos]) && !isDelim(b[this.pos])) this.pos++;
    if (this.pos === s) throw new Error('읽을 수 없는 문자');
    const word = String.fromCharCode(...b.subarray(s, this.pos));
    if (word === 'true') return { value: true };
    if (word === 'false') return { value: false };
    if (word === 'null') return { value: null };
    return { kw: word };
  }

  hexString(): Uint8Array {
    const { b } = this;
    this.pos++;
    const digits: number[] = [];
    while (this.pos < b.length && b[this.pos] !== 62) {
      const c = b[this.pos++];
      const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (v >= 0) digits.push(v);
    }
    if (this.pos >= b.length) throw new Error('16진 문자열이 끝나지 않음');
    this.pos++;
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = digits[i * 2] * 16 + digits[i * 2 + 1];
    return out;
  }

  literalString(): Uint8Array {
    const { b } = this;
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      let c = b[this.pos++];
      if (c === 92) {
        c = b[this.pos++];
        if (c === 110) out.push(10);
        else if (c === 114) out.push(13);
        else if (c === 116) out.push(9);
        else if (c === 98) out.push(8);
        else if (c === 102) out.push(12);
        else if (c >= 48 && c <= 55) {
          let v = c - 48;
          for (let i = 0; i < 2 && b[this.pos] >= 48 && b[this.pos] <= 55; i++) v = v * 8 + (b[this.pos++] - 48);
          out.push(v & 255);
        } else if (c === 13) {
          if (b[this.pos] === 10) this.pos++;
        } else if (c !== 10) out.push(c);
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41 && --depth === 0) return Uint8Array.from(out);
      out.push(c);
    }
    throw new Error('문자열이 끝나지 않음');
  }

  /** BI … ID <이미지 데이터> EI : EI 다음 위치를 돌려준다 */
  skipInlineImage(): number {
    const { b } = this;
    for (;;) {
      this.skipWs();
      if (this.pos >= b.length) throw new Error('인라인 이미지가 끝나지 않음');
      const t = this.read();
      if (t.kw === 'ID') break;
    }
    this.pos++; // ID 뒤 공백 한 칸
    for (let i = this.pos; i + 1 < b.length; i++) {
      if (b[i] === 69 && b[i + 1] === 73 && isWs(b[i - 1]) && (i + 2 >= b.length || isWs(b[i + 2]) || isDelim(b[i + 2]))) {
        this.pos = i + 2;
        return this.pos;
      }
    }
    throw new Error('EI 를 찾지 못함');
  }
}

function parseOps(bytes: Uint8Array): Op[] {
  const lx = new Lexer(bytes);
  const ops: Op[] = [];
  let args: Operand[] = [];
  let argStart = -1;
  for (;;) {
    lx.skipWs();
    if (lx.pos >= bytes.length) break;
    const start = lx.pos;
    const t = lx.read();
    if (t.kw === undefined) {
      if (argStart < 0) argStart = start;
      args.push(t.value!);
      continue;
    }
    const opStart = argStart >= 0 ? argStart : start;
    const end = t.kw === 'BI' ? lx.skipInlineImage() : lx.pos;
    ops.push({ op: t.kw, args, start: opStart, end });
    args = [];
    argStart = -1;
  }
  return ops;
}

// ---------------------------------------------------------------------------
// 글꼴 폭
// ---------------------------------------------------------------------------

interface FontWidths {
  twoByte: boolean;
  width(code: number): number | null; // 1000 단위
}

const num = (o: unknown) => (o instanceof PDFNumber ? o.asNumber() : undefined);

function readFont(doc: PDFDocument, fontDict: PDFDict | undefined): FontWidths | null {
  if (!fontDict) return null;
  const subtype = fontDict.lookup(PDFName.of('Subtype'));
  const st = subtype instanceof PDFName ? subtype.decodeText() : '';
  if (st === 'Type0') {
    const enc = fontDict.lookup(PDFName.of('Encoding'));
    if (!(enc instanceof PDFName) || enc.decodeText() !== 'Identity-H') return null;
    const desc = fontDict.lookup(PDFName.of('DescendantFonts'));
    const cid = desc instanceof PDFArray ? doc.context.lookup(desc.get(0)) : undefined;
    if (!(cid instanceof PDFDict)) return null;
    const dw = num(cid.lookup(PDFName.of('DW'))) ?? 1000;
    const single = new Map<number, number>();
    const ranges: Array<[number, number, number]> = [];
    const W = cid.lookup(PDFName.of('W'));
    if (W instanceof PDFArray) {
      for (let i = 0; i < W.size(); ) {
        const first = num(W.lookup(i));
        const next = W.lookup(i + 1);
        if (first === undefined) return null;
        if (next instanceof PDFArray) {
          for (let k = 0; k < next.size(); k++) {
            const w = num(next.lookup(k));
            if (w !== undefined) single.set(first + k, w);
          }
          i += 2;
        } else {
          const last = num(next);
          const w = num(W.lookup(i + 2));
          if (last === undefined || w === undefined) return null;
          ranges.push([first, last, w]);
          i += 3;
        }
      }
    }
    return {
      twoByte: true,
      width: (code) => {
        const s = single.get(code);
        if (s !== undefined) return s;
        for (const [a, z, w] of ranges) if (code >= a && code <= z) return w;
        return dw;
      },
    };
  }
  if (st === 'TrueType' || st === 'Type1' || st === 'MMType1') {
    const first = num(fontDict.lookup(PDFName.of('FirstChar')));
    const widths = fontDict.lookup(PDFName.of('Widths'));
    if (first === undefined || !(widths instanceof PDFArray)) return st === 'Type1' ? standardFont(fontDict) : null;
    const fd = fontDict.lookup(PDFName.of('FontDescriptor'));
    const missing = (fd instanceof PDFDict ? num(fd.lookup(PDFName.of('MissingWidth'))) : undefined) ?? 0;
    const list = Array.from({ length: widths.size() }, (_, i) => num(widths.lookup(i)));
    return {
      twoByte: false,
      width: (code) => {
        const i = code - first;
        return i >= 0 && i < list.length ? (list[i] ?? missing) : missing;
      },
    };
  }
  return null;
}

const STANDARD = new Set([
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
  'Symbol', 'ZapfDingbats',
]);
const codeNames = new Map<string, Map<number, string>>();

/** 폭 정보 없이 이름만 있는 표준 14 글꼴: pdf-lib 에 들어 있는 AFM 글자 폭을 쓴다 */
function standardFont(fontDict: PDFDict): FontWidths | null {
  const base = fontDict.lookup(PDFName.of('BaseFont'));
  const name = base instanceof PDFName ? base.decodeText() : '';
  if (!STANDARD.has(name)) return null;
  const enc = fontDict.lookup(PDFName.of('Encoding'));
  if (enc !== undefined && !(enc instanceof PDFName && enc.decodeText() === 'WinAnsiEncoding')) return null;
  const encoding = name === 'Symbol' ? Encodings.Symbol : name === 'ZapfDingbats' ? Encodings.ZapfDingbats : Encodings.WinAnsi;
  let map = codeNames.get(encoding.name);
  if (!map) {
    map = new Map();
    for (const cp of encoding.supportedCodePoints) {
      const g = encoding.encodeUnicodeCodePoint(cp);
      if (!map.has(g.code)) map.set(g.code, g.name);
    }
    codeNames.set(encoding.name, map);
  }
  const font = Font.load(name as IFontNames);
  const names = map;
  return {
    twoByte: false,
    width: (code) => {
      const glyph = names.get(code);
      const w = glyph ? font.getWidthOfGlyph(glyph) : undefined;
      return typeof w === 'number' ? w : null;
    },
  };
}

// ---------------------------------------------------------------------------
// 해석·삭제
// ---------------------------------------------------------------------------

const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: Matrix, x: number, y: number) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
const I: Matrix = [1, 0, 0, 1, 0, 0];
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

function readContent(page: PDFPage): Uint8Array | null {
  const contents = page.node.Contents();
  const streams: PDFStream[] = [];
  if (contents instanceof PDFStream) streams.push(contents);
  else if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = contents.lookup(i);
      if (!(s instanceof PDFStream)) return null;
      streams.push(s);
    }
  } else return null;
  const parts: Uint8Array[] = [];
  for (const s of streams) {
    if (s instanceof PDFRawStream) parts.push(decodePDFRawStream(s).decode());
    else if (typeof (s as unknown as { getUnencodedContents?: () => Uint8Array }).getUnencodedContents === 'function') {
      parts.push((s as unknown as { getUnencodedContents: () => Uint8Array }).getUnencodedContents());
    } else return null;
  }
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
    out[o++] = 10;
  }
  return out;
}

export interface RemoveResult {
  /** 사각형마다: 그 안의 원래 글자를 모두 지웠는지 (false 면 하나도 지우지 않았다 → 덮개로 가려야 한다) */
  ok: boolean[];
  removed: number; // 지운 명령 수
}

/**
 * 사각형 하나에 걸친 글자 명령이 '모두' 지울 수 있는 것일 때만 그 사각형의 글자를 지운다 (전부 아니면 전무).
 * 그래서 지운 곳은 새 글자로 다시 그리고, 못 지운 곳은 원래 글자를 그대로 두거나 덮으면 된다.
 */
export interface TextOpInfo {
  op: string;
  p0: number[];
  p1: number[];
  known: boolean;
  touching: number[];
  inside: number[];
}

export function removeTextInRects(
  doc: PDFDocument,
  page: PDFPage,
  rects: UserRect[],
  debug?: (info: TextOpInfo) => void, // 테스트용: 글자 명령마다 계산한 위치
): RemoveResult {
  const none = { ok: rects.map(() => false), removed: 0 };
  if (!rects.length) return none;
  let bytes: Uint8Array | null;
  let ops: Op[];
  try {
    bytes = readContent(page);
    if (!bytes) return none;
    ops = parseOps(bytes);
  } catch (err) {
    console.warn('내용 스트림을 해석하지 못해 원래 글자는 덮기만 합니다:', err);
    return none;
  }

  const resRef = page.node.getInheritableAttribute(PDFName.of('Resources'));
  const resources = resRef ? doc.context.lookupMaybe(resRef, PDFDict) : undefined;
  const fontRes = resources?.lookup(PDFName.of('Font'));
  const fontCache = new Map<string, FontWidths | null>();
  const fontByName = (name: string) => {
    if (!fontCache.has(name)) {
      const d = fontRes instanceof PDFDict ? fontRes.lookup(PDFName.of(name)) : undefined;
      fontCache.set(name, d instanceof PDFDict ? readFont(doc, d) : null);
    }
    return fontCache.get(name)!;
  };

  const tol = 0.8;
  const inside = (r: UserRect, p: number[]) => p[0] >= r.x0 - tol && p[0] <= r.x1 + tol && p[1] >= r.y0 - tol && p[1] <= r.y1 + tol;
  // 경계에 딱 붙어 시작·끝나는 이웃 조각은 걸친 것으로 보지 않는다 (1pt 안쪽으로 줄여서 비교)
  const edge = 1;
  const touches = (r: UserRect, a: number[], b: number[]) =>
    Math.max(a[0], b[0]) > r.x0 + edge &&
    Math.min(a[0], b[0]) < r.x1 - edge &&
    Math.max(a[1], b[1]) > r.y0 + edge &&
    Math.min(a[1], b[1]) < r.y1 - edge;

  interface GS {
    ctm: Matrix;
    tc: number;
    tw: number;
    th: number;
    tl: number;
    ts: number;
    tfs: number;
    font: FontWidths | null;
  }
  let gs: GS = { ctm: I, tc: 0, tw: 0, th: 1, tl: 0, ts: 0, tfs: 0, font: null };
  const stack: GS[] = [];
  let tm: Matrix = I;
  let tlm: Matrix = I;
  interface Hit {
    op: Op;
    touching: number[];
    inside: Set<number>;
    can: boolean;
    repl: string;
  }
  const hits: Hit[] = [];

  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
    tm = tlm;
  };

  const show = (op: Op, items: Operand[], removable: boolean) => {
    const font = gs.font;
    let known = !!font;
    let tx = 0;
    for (const it of items) {
      if (typeof it === 'number') {
        tx += (-it / 1000) * gs.tfs * gs.th;
      } else if (it instanceof Uint8Array) {
        const step = font?.twoByte ? 2 : 1;
        for (let i = 0; i + step <= it.length; i += step) {
          const code = step === 2 ? (it[i] << 8) | it[i + 1] : it[i];
          let w = font ? font.width(code) : null;
          if (w === null) {
            known = false;
            w = 0;
          }
          tx += ((w / 1000) * gs.tfs + gs.tc + (step === 1 && code === 32 ? gs.tw : 0)) * gs.th;
        }
      }
    }
    const m = mul(tm, gs.ctm);
    const p0 = apply(m, 0, gs.ts);
    const p1 = apply(m, tx, gs.ts);
    const touching: number[] = [];
    const ins = new Set<number>();
    rects.forEach((r, i) => {
      if (!touches(r, p0, p1)) return;
      touching.push(i);
      if (inside(r, p0) && inside(r, p1)) ins.add(i);
    });
    debug?.({ op: op.op, p0, p1, known, touching, inside: [...ins] });
    if (touching.length) {
      const can = removable && known && gs.tfs !== 0 && gs.th !== 0;
      hits.push({ op, touching, inside: ins, can, repl: can ? ` [${fmt((-tx * 1000) / (gs.tfs * gs.th))}] TJ ` : '' });
    }
    tm = mul([1, 0, 0, 1, tx, 0], tm);
  };

  try {
    for (const op of ops) {
      const a = op.args;
      const n = (i: number) => (typeof a[i] === 'number' ? (a[i] as number) : 0);
      switch (op.op) {
        case 'q':
          stack.push({ ...gs });
          break;
        case 'Q':
          gs = stack.pop() ?? gs;
          break;
        case 'cm':
          gs.ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], gs.ctm);
          break;
        case 'BT':
          tm = I;
          tlm = I;
          break;
        case 'Tc':
          gs.tc = n(0);
          break;
        case 'Tw':
          gs.tw = n(0);
          break;
        case 'Tz':
          gs.th = n(0) / 100;
          break;
        case 'TL':
          gs.tl = n(0);
          break;
        case 'Ts':
          gs.ts = n(0);
          break;
        case 'Tf':
          gs.font = a[0] instanceof Name ? fontByName(a[0].name) : null;
          gs.tfs = n(1);
          break;
        case 'Td':
          tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
          tm = tlm;
          break;
        case 'TD':
          gs.tl = -n(1);
          tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
          tm = tlm;
          break;
        case 'Tm':
          tlm = [n(0), n(1), n(2), n(3), n(4), n(5)];
          tm = tlm;
          break;
        case 'T*':
          nextLine();
          break;
        case 'Tj':
          show(op, [a[0]], true);
          break;
        case 'TJ':
          show(op, Array.isArray(a[0]) ? (a[0] as Operand[]) : [], true);
          break;
        case "'":
          nextLine();
          show(op, [a[0]], false);
          break;
        case '"':
          gs.tw = n(0);
          gs.tc = n(1);
          nextLine();
          show(op, [a[2]], false);
          break;
        default:
          break;
      }
    }
  } catch (err) {
    console.warn('내용 스트림 해석 중 문제가 생겨 원래 글자는 덮기만 합니다:', err);
    return none;
  }

  // 사각형이 '깨끗하게' 지워지는지: 걸친 명령이 하나 이상 있고, 모두 지울 수 있으며 그 사각형 안에 들어감
  const ok = rects.map(() => false);
  const blocked = rects.map(() => false);
  for (const h of hits) {
    for (const i of h.touching) {
      ok[i] = true;
      if (!h.can || !h.inside.has(i)) blocked[i] = true;
    }
  }
  blocked.forEach((b, i) => b && (ok[i] = false));
  const replace = new Map<Op, string>();
  for (const h of hits) {
    if (h.can && [...h.inside].some((i) => ok[i])) replace.set(h.op, h.repl);
  }
  if (!replace.size) return { ok, removed: 0 };

  // 지운 명령만 바꿔 끼운 새 내용 스트림
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let last = 0;
  for (const op of ops) {
    const r = replace.get(op);
    if (r === undefined) continue;
    chunks.push(bytes.subarray(last, op.start), enc.encode(r));
    last = op.end;
  }
  chunks.push(bytes.subarray(last));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  const ref = doc.context.register(doc.context.flateStream(out));
  page.node.set(PDFName.of('Contents'), ref);
  return { ok, removed: replace.size };
}
