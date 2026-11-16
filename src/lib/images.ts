import { clamp } from './geometry';
import { t } from './i18n';
import { uid } from './store';
import type { ImageAnnotation, ImageAsset, PageInfo } from './types';

function sniff(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

/** JPEG EXIF 회전 값 (1 = 회전 없음) */
function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00) break;
    if (marker === 0xffda) break; // 이미지 데이터 시작
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      if (tiff + 8 > view.byteLength) break;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) break;
      const count = view.getUint16(ifd, little);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) break;
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
      }
      return 1;
    }
    offset += 2 + size;
  }
  return 1;
}

async function encode(source: CanvasImageSource & { width: number; height: number }, type: 'image/png' | 'image/jpeg') {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d')!;
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(source, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error(t('err.imageConvert'));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 이미지 파일을 PDF에 넣을 수 있는 형태(PNG/JPEG)로 준비한다.
 * - PNG/JPEG 는 원본 그대로 (화질 손실 없음)
 * - 회전 정보(EXIF)가 있는 JPEG 는 화면에 보이는 방향으로 다시 저장
 * - 그 밖의 형식(WEBP, GIF, BMP 등)은 PNG 로 변환
 */
export async function loadImageFile(file: Blob): Promise<ImageAsset> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  let kind = sniff(bytes);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes]));
  } catch {
    throw new Error(t('err.imageRead'));
  }
  try {
    if (kind === 'jpg' && jpegOrientation(bytes) > 1) bytes = await encode(bitmap, 'image/jpeg');
    else if (kind === null) {
      bytes = await encode(bitmap, 'image/png');
      kind = 'png';
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: kind === 'png' ? 'image/png' : 'image/jpeg' }));
    return { id: uid('img'), bytes, kind, width: bitmap.width, height: bitmap.height, url };
  } finally {
    bitmap.close();
  }
}

/** pdf-lib 가 원본을 읽지 못할 때의 대비책: 브라우저로 디코딩해 표준 PNG 로 다시 만든다. */
export async function reencodeAsPng(asset: ImageAsset): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([asset.bytes as Uint8Array<ArrayBuffer>]));
  try {
    return await encode(bitmap, 'image/png');
  } finally {
    bitmap.close();
  }
}

/** 페이지에 놓을 이미지 주석을 만든다. at 점을 중심으로. fit 을 주면 그 크기(pt) 안에 들어가게 (서명) */
export function makeImageAnnotation(
  asset: ImageAsset,
  page: PageInfo,
  at: { x: number; y: number },
  fit?: { w: number; h: number },
): ImageAnnotation {
  let w = asset.width * 0.75; // px → pt (96dpi 기준)
  let h = asset.height * 0.75;
  if (fit) {
    const f = Math.min(fit.w / w, fit.h / h);
    w *= f;
    h *= f;
  }
  const k = Math.min(1, (page.width * 0.5) / w, (page.height * 0.5) / h);
  w = Math.max(8, w * k);
  h = Math.max(8, h * k);
  return {
    id: uid('i'),
    type: 'image',
    page: page.index,
    x: clamp(at.x - w / 2, 0, Math.max(0, page.width - w)),
    y: clamp(at.y - h / 2, 0, Math.max(0, page.height - h)),
    w,
    h,
    imageId: asset.id,
  };
}
