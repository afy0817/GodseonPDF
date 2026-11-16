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
  stroke,
} from '@cantoo/pdf-lib';
import { baselineRatio, fontBytes, type FontKey, LINE_HEIGHT } from './fonts';
import { hexToRgb, invert, strokeSegments } from './geometry';
import { cellLinePositions, HEADER_FILL, layoutTable, TABLE_BORDER_WIDTH } from './table';
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
  /** none: 원래 암호화 안 됨 / kept: 같은 암호로 다시 암호화 / removed: 보안 설정(권한 제한) 제거됨 */
  encryption: 'none' | 'kept' | 'removed';
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
    throw new Error(`암호화된 PDF를 해독하지 못했습니다. (${(err as Error)?.message ?? err})`);
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
    throw new Error('PDF 페이지 구조를 해석하지 못했습니다. (페이지 수 불일치)');
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
      if (!bytes) throw new Error('글꼴이 아직 준비되지 않았습니다.');
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
  const drawLine = async (page: PDFPage, line: string, x: number, baseline: number, size: number, bold: boolean, color: ReturnType<typeof rgb>) => {
    const primary = await getFont(bold ? 'bold' : 'regular');
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
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, x, baseline));
    let dx = 0;
    for (const run of runs) {
      page.drawText(run.text, { x: dx, y: 0, size, font: run.f.font, color });
      dx += run.f.font.widthOfTextAtSize(run.text, size);
    }
    page.pushOperators(popGraphicsState());
  };

  const baselineOf = (size: number, bold: boolean) => size * (bold ? baselineRatio.bold : baselineRatio.regular);

  const drawText = async (page: PDFPage, a: TextAnnotation) => {
    const color = rgb(...hexToRgb(a.color));
    const lineHeight = a.size * LINE_HEIGHT;
    for (const [i, raw] of a.text.split('\n').entries()) {
      const line = raw.replace(/\t/g, '    ');
      if (line.trim()) await drawLine(page, line, a.x, a.y + i * lineHeight + baselineOf(a.size, a.bold), a.size, a.bold, color);
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
          if (ln.text.trim()) await drawLine(page, ln.text, ln.x, ln.top + baselineOf(a.size, ln.bold), a.size, ln.bold, color);
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

  for (const info of input.pages) {
    if (input.deleted.has(info.index)) continue;
    const anns = input.annotations.filter((a) => a.page === info.index);
    if (!anns.length) continue;
    const page = doc.getPage(info.index);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...invert(info.transform)));
    // 화면과 같은 순서: 형광펜(아래) → 글상자·이미지(위)
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
  return { bytes, missingChars: [...missing], encryption };
}
