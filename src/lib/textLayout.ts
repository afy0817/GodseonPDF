import fontkit from '@cantoo/fontkit';
import { t } from './i18n';
import { type FontKey, fontBytes, type FontStyle, textFontKey } from './fonts';

/**
 * 글꼴 파일의 글자 폭(hmtx)으로 글줄 너비를 재고 줄을 나눈다.
 * 화면 표시와 PDF 저장이 같은 함수를 쓰므로 표 칸의 줄바꿈 위치가 똑같다.
 * 글꼴 선택 규칙도 저장과 같다: 나눔고딕 → (없는 글자면) 보조 글꼴.
 */
interface Metrics {
  upm: number;
  adv: Map<number, number>;
  has: Map<number, boolean>;
  font: { unitsPerEm: number; hasGlyphForCodePoint(cp: number): boolean; glyphForCodePoint(cp: number): { advanceWidth: number } };
}

const metrics = new Map<FontKey, Metrics>();

function load(key: FontKey): Metrics {
  let m = metrics.get(key);
  if (!m) {
    const bytes = fontBytes[key];
    if (!bytes) throw new Error(t('err.fontsNotReady'));
    const font = fontkit.create(bytes as never) as unknown as Metrics['font'];
    m = { font, upm: font.unitsPerEm, adv: new Map(), has: new Map() };
    metrics.set(key, m);
  }
  return m;
}

function has(m: Metrics, cp: number) {
  let v = m.has.get(cp);
  if (v === undefined) {
    v = m.font.hasGlyphForCodePoint(cp);
    m.has.set(cp, v);
  }
  return v;
}

function advance(m: Metrics, cp: number) {
  let v = m.adv.get(cp);
  if (v === undefined) {
    v = m.font.glyphForCodePoint(cp).advanceWidth / m.upm;
    m.adv.set(cp, v);
  }
  return v;
}

export function measureText(text: string, size: number, bold: boolean, font?: FontStyle): number {
  const primary = load(textFontKey(font, bold));
  const fallback = load(bold ? 'fallbackBold' : 'fallbackRegular');
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const m = cp <= 0x20 || has(primary, cp) ? primary : has(fallback, cp) ? fallback : primary;
    w += advance(m, cp);
  }
  return w * size;
}

/** 우리 글꼴(본 글꼴 또는 보조 글꼴)에 있는 문자인지 */
export function hasGlyph(cp: number, bold: boolean, font?: FontStyle): boolean {
  return cp <= 0x20 || has(load(textFontKey(font, bold)), cp) || has(load(bold ? 'fallbackBold' : 'fallbackRegular'), cp);
}

// 어느 글꼴에도 없는 문자를 모양이 거의 같은 문자로 (원래 PDF 글자를 옮겨 쓸 때만)
const LOOKALIKE: Record<string, string> = {
  '\u2219': '\u00b7', // ∙ → ·
  '\u2027': '\u00b7',
  '\u30fb': '\u00b7',
  '\uff65': '\u00b7',
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2015': '\u2014',
  '\u00a0': ' ',
  '\u2007': ' ',
  '\u202f': ' ',
};

export function substituteMissing(text: string, bold: boolean, font?: FontStyle): string {
  let out = '';
  for (const ch of text) {
    const alt = LOOKALIKE[ch];
    out += alt && !hasGlyph(ch.codePointAt(0)!, bold, font) ? alt : ch;
  }
  return out;
}

/**
 * maxWidth 안에 들어가도록 줄을 나눈다. 띄어쓰기 단위로 나누고(한글도 어절 단위),
 * 한 어절이 칸보다 길 때만 글자 단위로 자른다. 줄 끝 공백은 너비에 넣지 않는다.
 */
export function wrapText(text: string, maxWidth: number, size: number, bold: boolean): string[] {
  const out: string[] = [];
  const fits = (s: string) => measureText(s.trimEnd(), size, bold) <= maxWidth + 0.01;
  const breakLong = (token: string): string => {
    let cur = '';
    for (const ch of token) {
      if (cur && !fits(cur + ch)) {
        out.push(cur.trimEnd());
        cur = ch;
      } else {
        cur += ch;
      }
    }
    return cur;
  };
  for (const para of text.split('\n')) {
    if (!para) {
      out.push('');
      continue;
    }
    const tokens = para.match(/\S+\s*|\s+/g) ?? [para];
    let line = '';
    for (const tok of tokens) {
      if (!line) line = fits(tok) ? tok : breakLong(tok);
      else if (fits(line + tok)) line += tok;
      else {
        out.push(line.trimEnd());
        line = fits(tok) ? tok : breakLong(tok);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
