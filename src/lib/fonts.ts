/**
 * 글상자에 쓰는 글꼴. 화면 표시와 PDF 저장에 "같은 글꼴 파일"을 쓰기 때문에
 * 화면에서 본 위치·크기 그대로 PDF에 들어간다.
 *   고딕: 나눔고딕 / 명조: 나눔명조 (SIL OFL 1.1)
 *   보조: 두 글꼴에 없는 문자(㈜, ①, ✓, 가나 등)를 위한 Noto Sans KR 파생 글꼴
 */
import { t } from './i18n';

export const FONT_FAMILY = 'GodseonSans';
export const SERIF_FAMILY = 'GodseonSerif';
export const FALLBACK_FAMILY = 'GodseonFallback';
export const LINE_HEIGHT = 1.25;

export type FontKey = 'regular' | 'bold' | 'serifRegular' | 'serifBold' | 'fallbackRegular' | 'fallbackBold';
export type TextFontKey = 'regular' | 'bold' | 'serifRegular' | 'serifBold';
export type FontStyle = 'sans' | 'serif';

export const fontBytes: Record<FontKey, Uint8Array | null> = {
  regular: null,
  bold: null,
  serifRegular: null,
  serifBold: null,
  fallbackRegular: null,
  fallbackBold: null,
};

/** 줄 상자 위쪽에서 글자 기준선(baseline)까지의 거리 / 글자 크기 */
export const baselineRatio: Record<TextFontKey, number> = { regular: 0.95, bold: 0.95, serifRegular: 0.95, serifBold: 0.95 };

export function textFontKey(font: string | undefined, bold: boolean): TextFontKey {
  if (font === 'serif') return bold ? 'serifBold' : 'serifRegular';
  return bold ? 'bold' : 'regular';
}

export function cssFamily(font: FontStyle | undefined) {
  return `${font === 'serif' ? SERIF_FAMILY : FONT_FAMILY}, ${FALLBACK_FAMILY}, sans-serif`;
}

async function fetchBytes(rel: string): Promise<Uint8Array> {
  const res = await fetch(new URL(rel, document.baseURI));
  if (!res.ok) throw new Error(t('err.fontLoad', { file: rel }));
  return new Uint8Array(await res.arrayBuffer());
}

export function measureBaseline(family: string, weight: number): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;left:-10000px;top:0;white-space:pre;font-family:${family};font-size:100px;line-height:${LINE_HEIGHT};font-weight:${weight};font-kerning:none;font-synthesis:none`;
  probe.textContent = '가Hg';
  const marker = document.createElement('span');
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  probe.appendChild(marker);
  document.body.appendChild(probe);
  const ratio = (marker.getBoundingClientRect().top - probe.getBoundingClientRect().top) / 100;
  probe.remove();
  return ratio;
}

const FILES: Record<FontKey, [string, string, string]> = {
  regular: ['fonts/NanumGothic-Regular.ttf', FONT_FAMILY, '400'],
  bold: ['fonts/NanumGothic-Bold.ttf', FONT_FAMILY, '700'],
  serifRegular: ['fonts/NanumMyeongjo-Regular.ttf', SERIF_FAMILY, '400'],
  serifBold: ['fonts/NanumMyeongjo-Bold.ttf', SERIF_FAMILY, '700'],
  fallbackRegular: ['fonts/GodseonFallback-Regular.ttf', FALLBACK_FAMILY, '400'],
  fallbackBold: ['fonts/GodseonFallback-Bold.ttf', FALLBACK_FAMILY, '700'],
};

export async function loadFonts() {
  const keys = Object.keys(FILES) as FontKey[];
  const bytes = await Promise.all(keys.map((k) => fetchBytes(FILES[k][0])));
  keys.forEach((k, i) => (fontBytes[k] = bytes[i]));
  const faces = keys.map((k, i) => new FontFace(FILES[k][1], bytes[i].slice().buffer, { weight: FILES[k][2] }));
  await Promise.all(faces.map((f) => f.load()));
  faces.forEach((f) => document.fonts.add(f));
  baselineRatio.regular = measureBaseline(FONT_FAMILY, 400);
  baselineRatio.bold = measureBaseline(FONT_FAMILY, 700);
  baselineRatio.serifRegular = measureBaseline(SERIF_FAMILY, 400);
  baselineRatio.serifBold = measureBaseline(SERIF_FAMILY, 700);
}
