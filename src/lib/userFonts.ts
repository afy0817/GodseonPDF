import fontkit from '@cantoo/fontkit';
import { FALLBACK_FAMILY, FONT_FAMILY, measureBaseline, SERIF_FAMILY } from './fonts';
import { t } from './i18n';
import * as platform from './platform';

/**
 * 사용자가 추가한 글꼴 (TTF · OTF · TTC 의 한 글꼴 · WOFF).
 * 화면에는 FontFace 로, 저장할 때는 같은 파일을 부분 글꼴(subset)로 PDF 에 넣는다.
 * 글상자의 font 값은 'user:<id>' 이다.
 */
export interface UserFont {
  id: string;
  name: string;
  family: string; // CSS 글꼴 이름
  bytes: Uint8Array;
  baseline: number; // 줄 위쪽 → 기준선 / 글자 크기
  face: FontFace;
}

export interface FontCandidate {
  name: string;
  kind: string;
  data: Uint8Array;
  embeddable: boolean;
}

export const USER_PREFIX = 'user:';
const fonts = new Map<string, UserFont>();
let version = 0;

export const isUserFontId = (f?: string): f is string => !!f && f.startsWith(USER_PREFIX);

export function userFont(f?: string): UserFont | undefined {
  return isUserFontId(f) ? fonts.get(f.slice(USER_PREFIX.length)) : undefined;
}

export function listUserFonts(): UserFont[] {
  return [...fonts.values()];
}

/** 글꼴 목록이 바뀔 때마다 늘어난다 (옵션 막대가 목록을 다시 만들 때 비교) */
export function userFontsVersion() {
  return version;
}

/** 글상자에 쓸 CSS font-family (없는 글자는 보조 글꼴로) */
export function cssFamilyFor(font?: string): string {
  const uf = userFont(font);
  if (uf) return `"${uf.family}", ${FALLBACK_FAMILY}, sans-serif`;
  return font === 'serif' ? `${SERIF_FAMILY}, ${FALLBACK_FAMILY}, serif` : `${FONT_FAMILY}, ${FALLBACK_FAMILY}, sans-serif`;
}

async function register(id: string, name: string, bytes: Uint8Array): Promise<UserFont> {
  const family = `GodseonUser-${id}`;
  const face = new FontFace(family, bytes.slice().buffer);
  await face.load();
  document.fonts.add(face);
  const uf: UserFont = { id, name, family, bytes, baseline: measureBaseline(`"${family}"`, 400), face };
  fonts.set(id, uf);
  version += 1;
  return uf;
}

export async function loadSavedFonts() {
  for (const f of await platform.listFonts()) {
    try {
      await register(f.id, f.name, f.data);
    } catch (err) {
      console.warn('글꼴을 불러오지 못했습니다:', f.name, err);
    }
  }
}

/** 파일을 읽어 추가할 수 있는 글꼴 목록 (TTC 면 여러 개) */
export async function readFontFile(file: File): Promise<FontCandidate[]> {
  const faces = await platform.normalizeFont(new Uint8Array(await file.arrayBuffer()));
  const found: Array<FontCandidate & { hidden: boolean }> = [];
  for (const face of faces) {
    try {
      const f = fontkit.create(face.data as never) as unknown as {
        familyName?: string;
        subfamilyName?: string;
        numGlyphs?: number;
        layout?: unknown;
        ['OS/2']?: { fsType?: { noEmbedding?: boolean; bitmapOnly?: boolean } };
      };
      if (!f || typeof f.layout !== 'function' || !f.numGlyphs) continue;
      const family = String(f.familyName ?? '').trim();
      const sub = String(f.subfamilyName ?? '').trim();
      const base = family || file.name.replace(/\.[^.]+$/, '');
      const name = sub && !/^(regular|normal|book|roman|medium)$/i.test(sub) ? `${base} ${sub}` : base;
      const fsType = f['OS/2']?.fsType;
      found.push({ name, kind: face.kind, data: face.data, embeddable: !(fsType?.noEmbedding || fsType?.bitmapOnly), hidden: family.startsWith('.') });
    } catch {
      /* 읽을 수 없는 글꼴은 건너뛴다 */
    }
  }
  if (!found.length) throw new Error(t('err.fontRead'));
  const visible = found.filter((c) => !c.hidden);
  return (visible.length ? visible : found).map(({ hidden: _hidden, ...c }) => c);
}

export async function addFont(c: FontCandidate): Promise<UserFont> {
  const { id } = await platform.saveFont({ name: c.name, kind: c.kind, data: c.data });
  return register(id, c.name, c.data);
}

export async function removeUserFont(id: string) {
  const uf = fonts.get(id);
  if (!uf) return;
  await platform.removeFont(id);
  document.fonts.delete(uf.face);
  fonts.delete(id);
  version += 1;
}
