/**
 * 글상자에 쓰는 폰트. 화면 표시와 PDF 저장에 "같은 폰트 파일"을 쓰기 때문에
 * 화면에서 본 위치·크기 그대로 PDF에 들어간다. (나눔고딕, SIL OFL 1.1)
 */
export const FONT_FAMILY = 'GodseonSans';
/** 나눔고딕에 없는 문자(㈜, ①, ✓, 가나 등)를 위한 보조 글꼴 (Noto Sans KR 파생) */
export const FALLBACK_FAMILY = 'GodseonFallback';
export const LINE_HEIGHT = 1.25;

export type FontKey = 'regular' | 'bold' | 'fallbackRegular' | 'fallbackBold';

export const fontBytes: Record<FontKey, Uint8Array | null> = {
  regular: null,
  bold: null,
  fallbackRegular: null,
  fallbackBold: null,
};

/** 줄 상자 위쪽에서 글자 기준선(baseline)까지의 거리 / 글자 크기 */
export const baselineRatio = { regular: 0.95, bold: 0.95 };

async function fetchBytes(rel: string): Promise<Uint8Array> {
  const res = await fetch(new URL(rel, document.baseURI));
  if (!res.ok) throw new Error(`폰트를 불러오지 못했습니다: ${rel}`);
  return new Uint8Array(await res.arrayBuffer());
}

function measureBaseline(weight: number): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;left:-10000px;top:0;white-space:pre;font-family:${FONT_FAMILY};font-size:100px;line-height:${LINE_HEIGHT};font-weight:${weight};font-kerning:none;font-synthesis:none`;
  probe.textContent = '가Hg';
  const marker = document.createElement('span');
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  probe.appendChild(marker);
  document.body.appendChild(probe);
  const ratio = (marker.getBoundingClientRect().top - probe.getBoundingClientRect().top) / 100;
  probe.remove();
  return ratio;
}

export async function loadFonts() {
  const [regular, bold, fallbackRegular, fallbackBold] = await Promise.all([
    fetchBytes('fonts/NanumGothic-Regular.ttf'),
    fetchBytes('fonts/NanumGothic-Bold.ttf'),
    fetchBytes('fonts/GodseonFallback-Regular.ttf'),
    fetchBytes('fonts/GodseonFallback-Bold.ttf'),
  ]);
  Object.assign(fontBytes, { regular, bold, fallbackRegular, fallbackBold });
  const faces = [
    new FontFace(FONT_FAMILY, regular.slice().buffer, { weight: '400' }),
    new FontFace(FONT_FAMILY, bold.slice().buffer, { weight: '700' }),
    new FontFace(FALLBACK_FAMILY, fallbackRegular.slice().buffer, { weight: '400' }),
    new FontFace(FALLBACK_FAMILY, fallbackBold.slice().buffer, { weight: '700' }),
  ];
  await Promise.all(faces.map((f) => f.load()));
  faces.forEach((f) => document.fonts.add(f));
  baselineRatio.regular = measureBaseline(400);
  baselineRatio.bold = measureBaseline(700);
}
