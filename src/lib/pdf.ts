import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { t } from './i18n';
import type { PageInfo } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const asset = (rel: string) => new URL(rel, document.baseURI).href;

export class PasswordCancelled extends Error {
  constructor() {
    super(t('pw.cancelled'));
    this.name = 'PasswordCancelled';
  }
}

export interface LoadedPdf {
  pdf: pdfjs.PDFDocumentProxy;
  pages: PageInfo[];
  password?: string;
}

export async function loadPdf(
  data: Uint8Array,
  askPassword: (incorrect: boolean) => Promise<string | null>,
): Promise<LoadedPdf> {
  const task = pdfjs.getDocument({
    data: data.slice(), // pdf.js 가 버퍼를 워커로 넘기므로 사본을 준다
    cMapUrl: asset('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: asset('pdfjs/standard_fonts/'),
    wasmUrl: asset('pdfjs/wasm/'),
    iccUrl: asset('pdfjs/iccs/'),
    enableXfa: false,
    fontExtraProperties: true, // 글꼴 이름(바탕·고딕 등)을 받아 '기존 글자 고치기'에서 비슷한 글꼴을 고른다
  });
  let password: string | undefined;
  let cancelled = false;
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD).then((pw) => {
      if (pw === null) {
        cancelled = true;
        task.destroy();
      } else {
        password = pw;
        update(pw);
      }
    });
  };
  let pdf: pdfjs.PDFDocumentProxy;
  try {
    pdf = await task.promise;
  } catch (err) {
    if (cancelled) throw new PasswordCancelled();
    throw err;
  }
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, i) => {
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      return { index: i, width: vp.width, height: vp.height, transform: Array.from(vp.transform) } satisfies PageInfo;
    }),
  );
  return { pdf, pages, password };
}

export { pdfjs };
