import * as E from './editor';
import { baselineRatio, type FontStyle, textFontKey } from './fonts';
import { clamp } from './geometry';
import { store, uid } from './store';
import { measureText, substituteMissing } from './textLayout';
import { coverOverlap, sampleColors, samplerFor, textRunsOf } from './textRuns';
import type { TextAnnotation } from './types';
import type { Viewer } from './viewer';

export type ConvertMode = 'auto' | 'sans' | 'serif';

/**
 * 문서 전체 글꼴 바꾸기 (실험 기능).
 * 모든 원래 글줄을 '기존 글자 고치기' 글상자로 바꾼다 — 글자는 그대로, 글꼴만 나눔고딕/나눔명조로.
 * 글줄마다 가로 비율을 원래 폭에 맞춰 배치가 틀어지지 않게 한다. 한 번의 실행 취소로 되돌릴 수 있다.
 * 저장할 때 원래 글자를 지울 수 없는 곳은 덮개로 가린다 (exporter).
 */
export async function convertDocumentFonts(
  viewer: Viewer,
  mode: ConvertMode,
  progress: (done: number, total: number) => void,
): Promise<number> {
  E.finishEditing();
  const views = viewer.views.filter((v) => !store.deleted.has(v.info.index));
  const created: TextAnnotation[] = [];
  let done = 0;
  for (const v of views) {
    const runs = await textRunsOf(viewer, v);
    if (runs.length) {
      const sampler = await samplerFor(viewer, v);
      const existing = store.annotations.filter((a): a is TextAnnotation => a.type === 'text' && a.page === v.info.index && !!a.cover);
      for (const r of runs) {
        if (existing.some((a) => coverOverlap(a.cover!, r) > 0.5)) continue; // 이미 고친 글줄은 그대로
        const font: FontStyle = mode === 'auto' ? r.font : mode;
        const size = Math.round(r.size * 100) / 100;
        const key = textFontKey(font, r.bold);
        const text = substituteMissing(r.str, r.bold, font); // 뒤 공백도 그대로 (검색할 때 단어가 붙지 않게)
        const natural = measureText(text, size, r.bold, font);
        const scaleX = natural > 0 ? clamp(r.w / natural, 0.5, 2) : 1;
        const colors = sampleColors(sampler, r);
        created.push({
          id: uid('t'),
          type: 'text',
          page: v.info.index,
          x: r.x,
          y: r.baseline - size * baselineRatio[key],
          text,
          size,
          color: colors.text,
          bold: r.bold,
          font,
          cover: { x: r.x - 0.6, y: r.y - 0.3, w: r.w + 1.2, h: r.h + 0.6, color: colors.background },
          original: r.str,
          scaleX: Math.round(scaleX * 1000) / 1000,
        });
      }
    }
    progress(++done, views.length);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  if (created.length) E.addAnnotations(created, false);
  return created.length;
}
