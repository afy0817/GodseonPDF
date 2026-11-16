import type { OpenedFile, SaveResult } from './types';

/** electron/preload.cjs 가 노출하는 API */
interface GodseonApi {
  platform: string;
  openDialog(): Promise<OpenedFile | null>;
  openPath(path: string): Promise<OpenedFile>;
  pathForFile(file: File): string;
  save(path: string, data: Uint8Array): Promise<SaveResult>;
  saveAs(data: Uint8Array, suggestedName: string, defaultDir?: string): Promise<SaveResult | null>;
  confirmUnsaved(docName: string): Promise<'save' | 'discard' | 'cancel'>;
  setDocState(state: { dirty: boolean; hasDocument: boolean; title: string; path: string | null }): void;
  ready(): void;
  closeConfirmed(): void;
  onCommand(cb: (command: string) => void): () => void;
  onOpenFile(cb: (file: OpenedFile) => void): () => void;
  onSaveAndClose(cb: () => void): () => void;
}

declare global {
  interface Window {
    godseon?: GodseonApi;
  }
}

const api = window.godseon;

export const isElectron = !!api;
export const os: string =
  api?.platform ?? (/Mac/i.test(navigator.userAgent) ? 'darwin' : /Win/i.test(navigator.userAgent) ? 'win32' : 'linux');

/** IPC 오류 메시지에서 "Error invoking remote method ..." 접두어 제거 */
function clean(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''));
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw clean(err);
  }
}

function toUint8(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export async function openDialog(): Promise<OpenedFile | null> {
  if (api) {
    const f = await call(() => api.openDialog());
    return f ? { ...f, data: toUint8(f.data) } : null;
  }
  const input = document.getElementById('pdf-input') as HTMLInputElement;
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, path: null, data: new Uint8Array(await file.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function readDroppedPdf(file: File): Promise<OpenedFile> {
  if (api) {
    const p = api.pathForFile(file);
    if (p) {
      const f = await call(() => api.openPath(p));
      return { ...f, data: toUint8(f.data) };
    }
  }
  return { name: file.name, path: null, data: new Uint8Array(await file.arrayBuffer()) };
}

/**
 * 저장. path 가 있고 forceDialog 가 아니면 그 경로에 덮어쓰고, 아니면 저장 대화상자를 띄운다.
 * 브라우저에서 실행 중이면 파일 다운로드로 대신한다. 취소하면 null.
 */
export async function save(
  path: string | null,
  data: Uint8Array,
  suggestedName: string,
  forceDialog: boolean,
): Promise<SaveResult | null> {
  if (api) {
    if (path && !forceDialog) return call(() => api.save(path, data));
    return call(() => api.saveAs(data, suggestedName, path ? dirname(path) : undefined));
  }
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { name: suggestedName, path: null };
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}

export async function confirmUnsaved(docName: string): Promise<'save' | 'discard' | 'cancel'> {
  if (api) return call(() => api.confirmUnsaved(docName));
  return window.confirm(`"${docName}"의 변경 내용이 저장되지 않았습니다.\n저장하지 않고 계속할까요?`) ? 'discard' : 'cancel';
}

export function setDocState(state: { dirty: boolean; hasDocument: boolean; title: string; path: string | null }) {
  if (api) api.setDocState(state);
  else document.title = state.hasDocument ? `${state.dirty ? '● ' : ''}${state.title} — GodseonPDF` : 'GodseonPDF';
}

export function ready() {
  api?.ready();
}

export function closeConfirmed() {
  api?.closeConfirmed();
}

export function onCommand(cb: (command: string) => void) {
  api?.onCommand(cb);
}

export function onOpenFile(cb: (file: OpenedFile) => void) {
  api?.onOpenFile((f) => cb({ ...f, data: toUint8(f.data) }));
}

export function onSaveAndClose(cb: () => void) {
  api?.onSaveAndClose(cb);
}
