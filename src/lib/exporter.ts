import fontkit from '@cantoo/fontkit';
import {
  appendBezierCurve,
  concatTransformationMatrix,
  EncryptedPDFError,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
  type PDFRef,
  fill,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingRgbColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextRenderingMode,
  stroke,
  TextRenderingMode,
} from '@cantoo/pdf-lib';
import { removeTextInRects, type UserRect } from './contentEdit';
import { baselineRatio, fontBytes, type FontKey, LINE_HEIGHT, type TextFontKey, textFontKey } from './fonts';
import { t } from './i18n';
import { hexToRgb, invert, type Matrix, strokeSegments } from './geometry';
import { cellLinePositions, HEADER_FILL, layoutTable, TABLE_BORDER_WIDTH } from './table';
import { type UserFont, userFont } from './userFonts';
import type { Annotation, HighlightAnnotation, ImageAnnotation, ImageAsset, PageInfo, TableAnnotation, TextAnnotation } from './types';

export interface ExportInput {
  bytes: Uint8Array;
  password?: string;
  pages: PageInfo[];
  deleted: Set<number>;
  annotations: Annotation[];
  images: Map<string, ImageAsset>;
  reencodeImage: (asset: ImageAsset) => Promise<Uint8Array>;
}

export interface ExportResult {
  bytes: Uint8Array;
  /** 폰트에 없어 PDF에 표시되지 않는 문자 */
  missingChars: string[];
  /** '기존 글자 고치기'에서 원래 글자를 지우지 못해 덮기만 한 곳의 수 (검색하면 원래 글자가 나올 수 있다) */
  coveredOnly: number;
  /** none: 원래 암호화 안 됨 / kept: 같은 암호로 다시 암호화 / removed: 보안 설정(권한 제한) 제거됨 */
  encryption: 'none' | 'kept' | 'removed';
}

/** 페이지 단위(화면 방향) 사각형 → PDF 사용자 좌표 사각형 */
function toUserRect(inv: Matrix, c: { x: number; y: number; w: number; h: number }): UserRect {
  const pts = [
    [c.x, c.y],
    [c.x + c.w, c.y],
    [c.x, c.y + c.h],
    [c.x + c.w, c.y + c.h],
  ].map(([x, y]) => [x * inv[0] + y * inv[2] + inv[4], x * inv[1] + y * inv[3] + inv[5]]);
  return {
    x0: Math.min(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    x1: Math.max(...pts.map((p) => p[0])),
    y1: Math.max(...pts.map((p) => p[1])),
  };
}

function isEncryptedError(err: unknown) {
  return err instanceof EncryptedPDFError || /encrypted/i.test((err as Error)?.message ?? '');
}

async function loadForEditing(bytes: Uint8Array, password?: string) {
  try {
    return { doc: await PDFDocument.load(bytes, { updateMetadata: false }), decrypted: false };
  } catch (err) {
    if (!isEncryptedError(err)) throw err;
  }
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, password: password ?? '' });
    return { doc, decrypted: true };
  } catch (err) {
    throw new Error(t('err.decrypt', { msg: (err as Error)?.message ?? String(err) }));
  }
}

/**
 * 원본 PDF에 편집 내용을 "새긴" PDF를 만든다.
 *
 * 주석 좌표는 화면 기준(왼쪽 위 원점, y 아래로)이므로, pdf.js 가 화면에 그릴 때 쓴 변환 행렬의
 * 역행렬을 페이지 내용 끝에 cm 으로 걸어 준 뒤 화면 좌표 그대로 그린다.
 * 이렇게 하면 회전(/Rotate)·CropBox·원점이 0이 아닌 MediaBox 를 모두 자동으로 처리한다.
 */
export async function exportPdf(input: ExportInput): Promise<ExportResult> {
  const { doc, decrypted } = await loadForEditing(input.bytes, input.password);
  if (doc.getPageCount() !== input.pages.length) {
    throw new Error(t('err.pageCount'));
  }
  doc.registerFontkit(fontkit);

  interface EmbeddedFont {
    font: PDFFont;
    charset: Set<number>;
  }
  const fonts = new Map<FontKey, EmbeddedFont>();
  const missing = new Set<string>();
  // 실제로 쓰인 글자만 담는 부분 글꼴(subset)로 넣으므로 PDF 용량이 거의 늘지 않는다.
  const getFont = async (key: FontKey): Promise<EmbeddedFont> => {
    let f = fonts.get(key);
    if (!f) {
      const bytes = fontBytes[key];
      if (!bytes) throw new Error(t('err.fontsNotReady'));
      const font = await doc.embedFont(bytes, { subset: true, features: { liga: false, kern: false } });
      f = { font, charset: new Set(font.getCharacterSet()) };
      fonts.set(key, f);
    }
    return f;
  };

  const images = new Map<string, PDFImage>();
  const getImage = async (asset: ImageAsset) => {
    let img = images.get(asset.id);
    if (!img) {
      try {
        img = asset.kind === 'png' ? await doc.embedPng(asset.bytes) : await doc.embedJpg(asset.bytes);
      } catch {
        img = await doc.embedPng(await input.reencodeImage(asset));
      }
      images.set(asset.id, img);
    }
    return img;
  };

  const gsRefs = new Map<number, PDFRef>();
  const getGs = (opacity: number) => {
    let ref = gsRefs.get(opacity);
    if (!ref) {
      ref = doc.context.register(doc.context.obj({ Type: 'ExtGState', CA: opacity, ca: opacity, BM: 'Multiply' }));
      gsRefs.set(opacity, ref);
    }
    return ref;
  };

  const drawHighlight = (page: PDFPage, a: HighlightAnnotation) => {
    if (!a.points.length) return;
    const key = page.node.newExtGState('GS', getGs(a.opacity));
    const [r, g, b] = hexToRgb(a.color);
    const ops: PDFOperator[] = [
      pushGraphicsState(),
      setGraphicsState(key),
      setStrokingRgbColor(r, g, b),
      setLineWidth(a.width),
      setLineCap(LineCapStyle.Round),
      setLineJoin(LineJoinStyle.Round),
    ];
    let cx = 0;
    let cy = 0;
    for (const s of strokeSegments(a.points)) {
      if (s.t === 'M') ops.push(moveTo(s.x, s.y));
      else if (s.t === 'L') ops.push(lineTo(s.x, s.y));
      else {
        // 2차 베지어 → 3차 베지어
        ops.push(
          appendBezierCurve(
            cx + (2 / 3) * (s.cx - cx),
            cy + (2 / 3) * (s.cy - cy),
            s.x + (2 / 3) * (s.cx - s.x),
            s.y + (2 / 3) * (s.cy - s.y),
            s.x,
            s.y,
          ),
        );
      }
      cx = s.x;
      cy = s.y;
    }
    ops.push(stroke(), popGraphicsState());
    page.pushOperators(...ops);
  };

  /** 한 줄을 글자별 글꼴(나눔고딕 → 보조 글꼴)로 나눠 그린다. (x, baseline) 은 현재 좌표계(화면 방향) 기준 */
  // 사용자가 추가한 글꼴도 쓰인 글자만 부분 글꼴로 넣는다
  const userEmbedded = new Map<string, EmbeddedFont>();
  const getUserFont = async (uf: UserFont): Promise<EmbeddedFont> => {
    let f = userEmbedded.get(uf.id);
    if (!f) {
      const font = await doc.embedFont(uf.bytes, { subset: true, features: { liga: false, kern: false } });
      f = { font, charset: new Set(font.getCharacterSet()) };
      userEmbedded.set(uf.id, f);
    }
    return f;
  };

  /**
   * 한 줄을 그린다. 본 글꼴에 없는 글자는 보조 글꼴로.
   * fauxBold: 굵은 글꼴 파일이 없는 사용자 글꼴의 '굵게' — 화면(CSS 합성 굵게)과 비슷하게 글자 외곽선을 같이 칠한다.
   */
  const drawLine = async (
    page: PDFPage,
    line: string,
    x: number,
    baseline: number,
    size: number,
    primary: EmbeddedFont,
    bold: boolean,
    color: ReturnType<typeof rgb>,
    scaleX = 1,
    fauxBold = false,
  ) => {
    const runs: Array<{ text: string; f: EmbeddedFont }> = [];
    for (const ch of line) {
      const cp = ch.codePointAt(0)!;
      let f = primary;
      if (cp > 0x20 && !primary.charset.has(cp)) {
        const fallback = await getFont(bold ? 'fallbackBold' : 'fallbackRegular');
        if (fallback.charset.has(cp)) f = fallback;
        else missing.add(ch);
      }
      const last = runs[runs.length - 1];
      if (last && last.f === f) last.text += ch;
      else runs.push({ text: ch, f });
    }
    // 화면 좌표(y 아래로)에서 글자가 뒤집히지 않도록 기준선 위치에서 y 축을 다시 뒤집는다.
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(scaleX, 0, 0, -1, x, baseline));
    if (fauxBold) {
      page.pushOperators(
        setTextRenderingMode(TextRenderingMode.FillAndOutline),
        setLineWidth(size * 0.035),
        setStrokingRgbColor(color.red, color.green, color.blue),
      );
    }
    let dx = 0;
    for (const run of runs) {
      page.drawText(run.text, { x: dx, y: 0, size, font: run.f.font, color });
      dx += run.f.font.widthOfTextAtSize(run.text, size);
    }
    page.pushOperators(popGraphicsState());
  };

  const baselineOf = (size: number, key: TextFontKey) => size * baselineRatio[key];

  const drawText = async (page: PDFPage, a: TextAnnotation) => {
    const color = rgb(...hexToRgb(a.color));
    const lineHeight = a.size * LINE_HEIGHT;
    const uf = userFont(a.font);
    const key = textFontKey(a.font, a.bold);
    const primary = uf ? await getUserFont(uf) : await getFont(key);
    const baseline = uf ? a.size * uf.baseline : baselineOf(a.size, key);
    for (const [i, raw] of a.text.split('\n').entries()) {
      const line = raw.replace(/\t/g, '    ');
      if (line.trim()) {
        await drawLine(page, line, a.x, a.y + i * lineHeight + baseline, a.size, primary, a.bold, color, a.scaleX ?? 1, !!uf && a.bold);
      }
    }
  };

  const drawTable = async (page: PDFPage, a: TableAnnotation) => {
    const L = layoutTable(a);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, a.x, a.y));
    if (a.header) {
      page.pushOperators(setFillingRgbColor(...hexToRgb(HEADER_FILL)), rectangle(0, 0, L.width, L.rowY[1]), fill());
    }
    const lines: PDFOperator[] = [
      pushGraphicsState(),
      setStrokingRgbColor(...hexToRgb(a.border)),
      setLineWidth(TABLE_BORDER_WIDTH),
      setLineCap(LineCapStyle.Projecting), // 모서리가 비지 않도록 (화면: stroke-linecap: square)
    ];
    for (const x of L.colX) lines.push(moveTo(x, 0), lineTo(x, L.height));
    for (const y of L.rowY) lines.push(moveTo(0, y), lineTo(L.width, y));
    lines.push(stroke(), popGraphicsState());
    page.pushOperators(...lines);
    const color = rgb(...hexToRgb(a.color));
    for (let r = 0; r < a.rows.length; r++) {
      for (let c = 0; c < a.cols.length; c++) {
        for (const ln of cellLinePositions(a, L, r, c)) {
          const key: TextFontKey = ln.bold ? 'bold' : 'regular';
          if (ln.text.trim()) await drawLine(page, ln.text, ln.x, ln.top + baselineOf(a.size, key), a.size, await getFont(key), ln.bold, color);
        }
      }
    }
    page.pushOperators(popGraphicsState());
  };

  const drawImage = async (page: PDFPage, a: ImageAnnotation) => {
    const asset = input.images.get(a.imageId);
    if (!asset) return;
    const img = await getImage(asset);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, a.x, a.y + a.h));
    page.drawImage(img, { x: 0, y: 0, width: a.w, height: a.h });
    page.pushOperators(popGraphicsState());
  };

  let coveredOnly = 0;
  for (const info of input.pages) {
    if (input.deleted.has(info.index)) continue;
    const anns = input.annotations.filter((a) => a.page === info.index);
    if (!anns.length) continue;
    const page = doc.getPage(info.index);
    const inv = invert(info.transform);

    // 기존 글자 고치기: 원래 글자를 내용 스트림에서 지운다. 확실히 지울 수 있는 곳만 지우고, 나머지는 덮개로 가린다.
    const replaced = anns.filter((a): a is TextAnnotation => a.type === 'text' && !!a.cover);
    let removed: boolean[] = replaced.map(() => false);
    if (replaced.length) {
      removed = removeTextInRects(doc, page, replaced.map((a) => toUserRect(inv, a.cover!))).ok;
      coveredOnly += removed.filter((ok) => !ok).length;
    }

    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...inv));
    replaced.forEach((a, i) => {
      if (removed[i]) return;
      const c = a.cover!;
      page.pushOperators(setFillingRgbColor(...hexToRgb(c.color)), rectangle(c.x, c.y, c.w, c.h), fill());
    });
    // 화면과 같은 순서: 덮개 → 형광펜 → 글상자·이미지·표
    for (const a of anns) if (a.type === 'highlight') drawHighlight(page, a);
    for (const a of anns) {
      if (a.type === 'text') await drawText(page, a);
      else if (a.type === 'image') await drawImage(page, a);
      else if (a.type === 'table') await drawTable(page, a);
    }
    page.pushOperators(popGraphicsState());
  }

  const removeIdx = [...input.deleted].filter((i) => i >= 0 && i < input.pages.length).sort((a, b) => b - a);
  for (const i of removeIdx) doc.removePage(i);

  let encryption: ExportResult['encryption'] = 'none';
  if (decrypted) {
    if (input.password) {
      doc.encrypt({ userPassword: input.password, ownerPassword: input.password });
      encryption = 'kept';
    } else {
      encryption = 'removed';
    }
  }
  doc.setModificationDate(new Date());
  const bytes = await doc.save();
  return { bytes, missingChars: [...missing], encryption, coveredOnly };
}
