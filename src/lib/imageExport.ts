import { pdfjs } from './pdf';

export type ImageFormat = 'png' | 'jpg';

const MAX_SIDE = 14000; // 캔버스 한 변 최대 픽셀
const MAX_PIXELS = 60_000_000; // 한 장 최대 픽셀 수 (아주 큰 도면·포스터는 줄여서 그린다)
const JPEG_QUALITY = 0.92;
const asset = (rel: string) => new URL(rel, document.baseURI).href;

/** 파일 이름에 쓸 수 없는 문자(윈도우 기준)를 바꾼다 */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim() || 'document';
}

/** 페이지(pt, 1/72인치)를 dpi 로 그릴 때의 배율과 픽셀 크기 */
export function imageSize(width: number, height: number, dpi: number) {
  let scale = dpi / 72;
  scale = Math.min(scale, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  return { scale, width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export class ExportCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

/**
 * 편집 내용이 들어간 PDF(저장할 때와 같은 결과)를 페이지별 이미지로 만든다.
 * pageIndexes: 그 PDF 안의 페이지 순서(0부터). 한 장씩 그려서 onImage 로 넘기고 바로 버린다(메모리 절약).
 */
export async function renderPageImages(opts: {
  pdfBytes: Uint8Array;
  password?: string;
  pageIndexes: number[];
  format: ImageFormat;
  dpi: number;
  signal?: AbortSignal;
  onImage: (pageIndex: number, data: Uint8Array) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  const { pageIndexes, format, signal } = opts;
  const task = pdfjs.getDocument({
    data: opts.pdfBytes.slice(),
    password: opts.password,
    cMapUrl: asset('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: asset('pdfjs/standard_fonts/'),
    wasmUrl: asset('pdfjs/wasm/'),
    iccUrl: asset('pdfjs/iccs/'),
    enableXfa: false,
  });
  const check = () => {
    if (signal?.aborted) throw new ExportCancelled();
  };
  try {
    const doc = await task.promise;
    for (const [i, index] of pageIndexes.entries()) {
      check();
      opts.onProgress?.(i, pageIndexes.length);
      const page = await doc.getPage(index + 1);
      const natural = page.getViewport({ scale: 1 });
      const size = imageSize(natural.width, natural.height, opts.dpi);
      const viewport = page.getViewport({ scale: size.scale });
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      try {
        // 배경은 pdf.js 가 흰색으로 채운다 (JPG 도 검게 나오지 않는다)
        await page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
        check();
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', JPEG_QUALITY),
        );
        if (!blob) throw new Error(`canvas.toBlob (${size.width}×${size.height})`);
        const data = new Uint8Array(await blob.arrayBuffer());
        check();
        await opts.onImage(index, data);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
    opts.onProgress?.(pageIndexes.length, pageIndexes.length);
  } finally {
    await task.destroy().catch(() => {});
  }
}
