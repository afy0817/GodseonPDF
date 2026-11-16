import * as E from './lib/editor';
import { exportPdf } from './lib/exporter';
import { loadFonts } from './lib/fonts';
import { loadImageFile, makeImageAnnotation, reencodeAsPng } from './lib/images';
import { setupInteractions } from './lib/interactions';
import { isEditableTarget, setupKeyboard } from './lib/keyboard';
import { OptionsBar } from './lib/options';
import { loadPdf, PasswordCancelled } from './lib/pdf';
import * as platform from './lib/platform';
import { emit, livePages, on, store } from './lib/store';
import { Thumbnails } from './lib/thumbnails';
import type { ImageAnnotation, OpenedFile } from './lib/types';
import { $, describeError, hydrateIcons, promptPassword, setBusy, toast } from './lib/ui';
import { Viewer, type PageView } from './lib/viewer';

hydrateIcons();
document.documentElement.dataset.os = platform.os;
document.documentElement.classList.toggle('electron', platform.isElectron);

const app = $('#app');
const viewer = new Viewer($('#viewer'), $('#pages'));
const thumbs = new Thumbnails($('#thumbs'), viewer, (indices) => deletePages(indices));
const options = new OptionsBar($('#options'));
const fontsReady = loadFonts().catch((err) => {
  console.error(err);
  toast('글꼴을 불러오지 못했습니다. 글자 입력이 제대로 보이지 않을 수 있습니다.', { type: 'error' });
});

E.initEditor(viewer, () => pushDocState());
setupInteractions(viewer);

// ---------------------------------------------------------------------------
// 문서 상태 표시
// ---------------------------------------------------------------------------

function pushDocState() {
  const doc = store.doc;
  const dirty = !!doc && E.isDirty();
  platform.setDocState({ dirty, hasDocument: !!doc, title: doc?.name ?? '', path: doc?.path ?? null });
  const title = $('#doc-title');
  title.textContent = doc ? doc.name : '';
  title.title = doc?.path ?? doc?.name ?? '';
  title.classList.toggle('dirty', dirty);
}

function updatePageNav() {
  const live = livePages();
  const pos = live.findIndex((p) => p.index === store.currentPage);
  const input = $<HTMLInputElement>('#page-input');
  if (document.activeElement !== input) input.value = live.length ? String(pos + 1 || 1) : '';
  $('#page-total').textContent = `/ ${live.length}`;
  $('#sidebar-count').textContent = live.length ? `${live.length}` : '';
}

function updateToolbar() {
  const hasDoc = !!store.doc;
  document.querySelectorAll<HTMLButtonElement>('[data-needs-doc]').forEach((b) => {
    if ('disabled' in b) b.disabled = !hasDoc;
  });
  $<HTMLButtonElement>('[data-cmd="undo"]').disabled = !hasDoc || !E.history.canUndo;
  $<HTMLButtonElement>('[data-cmd="redo"]').disabled = !hasDoc || !E.history.canRedo;
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => {
    const active = b.dataset.tool === store.tool;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  app.dataset.tool = store.tool;
  $('#zoom-label').textContent = `${Math.round(store.zoom * 100)}%`;
}

on('history', () => {
  updateToolbar();
  pushDocState();
});
on('tool', () => {
  updateToolbar();
  options.update();
});
on('selection', () => options.update());
on('style', () => options.update());
on('zoom', () => updateToolbar());
on('currentPage', () => {
  updatePageNav();
  thumbs.update();
  thumbs.revealCurrent();
});
on('pages', () => {
  thumbs.update();
  updatePageNav();
});
on('pageSelection', () => thumbs.update());

// ---------------------------------------------------------------------------
// 열기
// ---------------------------------------------------------------------------

async function confirmDiscardChanges(): Promise<boolean> {
  E.finishEditing();
  if (!store.doc || !E.isDirty()) return true;
  const answer = await platform.confirmUnsaved(store.doc.name);
  if (answer === 'cancel') return false;
  if (answer === 'save') return save(false);
  return true;
}

function closeDocument() {
  const doc = store.doc;
  viewer.unmount();
  thumbs.clear();
  for (const img of store.images.values()) URL.revokeObjectURL(img.url);
  store.images.clear();
  store.doc = null;
  doc?.pdf.loadingTask.destroy().catch(() => {});
}

async function loadDocument(file: OpenedFile) {
  setBusy('PDF를 여는 중…');
  try {
    const loaded = await loadPdf(file.data, promptPassword);
    closeDocument();
    store.doc = {
      name: file.name,
      path: file.path,
      bytes: file.data,
      pdf: loaded.pdf,
      pages: loaded.pages,
      password: loaded.password,
    };
    store.annotations = [];
    store.deleted = new Set();
    store.selectedId = null;
    store.editingId = null;
    store.pageSelection = new Set();
    store.currentPage = 0;
    store.tool = 'select';
    app.classList.remove('no-doc');
    viewer.mount();
    thumbs.mount();
    E.resetHistory();
    emit('doc');
    emit('tool');
    emit('pages');
    emit('selection');
    emit('currentPage');
  } catch (err) {
    if (!(err instanceof PasswordCancelled)) {
      console.error(err);
      toast(`PDF를 열 수 없습니다: ${describeError(err)}`, { type: 'error' });
    }
  } finally {
    setBusy(null);
    updateToolbar();
    pushDocState();
  }
}

async function openWith(getFile: () => Promise<OpenedFile | null>) {
  if (!(await confirmDiscardChanges())) return;
  let file: OpenedFile | null;
  try {
    file = await getFile();
  } catch (err) {
    toast(`파일을 열 수 없습니다: ${describeError(err)}`, { type: 'error' });
    return;
  }
  if (file) await loadDocument(file);
}

// ---------------------------------------------------------------------------
// 저장
// ---------------------------------------------------------------------------

let saving = false;

async function save(forceDialog: boolean): Promise<boolean> {
  const doc = store.doc;
  if (!doc || saving) return false;
  E.finishEditing();
  saving = true;
  setBusy('저장하는 중…');
  try {
    await fontsReady;
    const result = await exportPdf({
      bytes: doc.bytes,
      password: doc.password,
      pages: doc.pages,
      deleted: store.deleted,
      annotations: store.annotations,
      images: store.images,
      reencodeImage: reencodeAsPng,
    });
    setBusy(null);
    const suggested = /\.pdf$/i.test(doc.name) ? doc.name : `${doc.name}.pdf`;
    const saved = await platform.save(doc.path, result.bytes, suggested, forceDialog);
    if (!saved) return false;
    doc.name = saved.name;
    if (saved.path) doc.path = saved.path;
    E.history.markSaved();
    emit('history');
    pushDocState();
    toast(platform.isElectron ? `저장했습니다: ${saved.name}` : `다운로드했습니다: ${saved.name}`, { type: 'success' });
    if (result.missingChars.length) {
      toast(`글꼴에 없는 문자는 PDF에 표시되지 않습니다: ${result.missingChars.slice(0, 12).join(' ')}`, { type: 'warn', duration: 8000 });
    }
    if (result.encryption === 'removed') {
      toast('원본 PDF의 보안 설정(인쇄·복사 제한 등)은 저장된 파일에 적용되지 않습니다.', { type: 'info', duration: 7000 });
    } else if (result.encryption === 'kept') {
      toast('저장된 파일도 원래 암호로 보호됩니다.', { type: 'info' });
    }
    return true;
  } catch (err) {
    console.error(err);
    toast(`저장하지 못했습니다: ${describeError(err)}`, { type: 'error', duration: 9000 });
    return false;
  } finally {
    saving = false;
    setBusy(null);
  }
}

// ---------------------------------------------------------------------------
// 이미지 삽입
// ---------------------------------------------------------------------------

async function insertImages(files: File[], drop?: { view: PageView; x: number; y: number }) {
  if (!store.doc || !files.length) return;
  E.finishEditing();
  const view = drop?.view ?? viewer.views[store.currentPage];
  if (!view) return;
  const center = drop ?? viewer.visibleCenter(view);
  const created: ImageAnnotation[] = [];
  for (const [i, file] of files.entries()) {
    try {
      const asset = await loadImageFile(file);
      store.images.set(asset.id, asset);
      created.push(makeImageAnnotation(asset, view.info, { x: center.x + i * 18, y: center.y + i * 18 }));
    } catch (err) {
      toast(`${file.name || '이미지'}: ${describeError(err)}`, { type: 'error' });
    }
  }
  if (!created.length) return;
  E.setTool('select');
  E.addAnnotations(created);
}

const imageInput = $<HTMLInputElement>('#image-input');
imageInput.addEventListener('change', () => {
  const files = Array.from(imageInput.files ?? []);
  imageInput.value = '';
  insertImages(files);
});

function pickImages() {
  if (!store.doc) return;
  imageInput.click();
}

// ---------------------------------------------------------------------------
// 페이지 삭제
// ---------------------------------------------------------------------------

function deletePages(indices?: number[]) {
  if (!store.doc) return;
  const targets = indices ?? (store.pageSelection.size ? [...store.pageSelection] : [store.currentPage]);
  const n = E.deletePages(targets);
  if (n === -1) toast('모든 페이지를 삭제할 수는 없습니다. 최소 한 페이지는 남아 있어야 합니다.', { type: 'warn' });
  else if (n > 0) toast(`${n}개 페이지를 삭제했습니다.`, { action: { label: '실행 취소', run: () => E.undo() } });
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

function inEditableField() {
  return isEditableTarget(document.activeElement);
}

const commands: Record<string, () => unknown> = {
  open: () => openWith(platform.openDialog),
  save: () => save(false),
  saveAs: () => save(true),
  undo: () => (inEditableField() ? document.execCommand('undo') : E.undo()),
  redo: () => (inEditableField() ? document.execCommand('redo') : E.redo()),
  zoomIn: () => viewer.zoomStep(1),
  zoomOut: () => viewer.zoomStep(-1),
  zoomReset: () => viewer.setZoom(1, 'custom'),
  zoomFit: () => viewer.zoomToMode('width'),
  toggleSidebar: () => {
    store.sidebarOpen = !store.sidebarOpen;
    app.classList.toggle('sidebar-hidden', !store.sidebarOpen);
  },
  insertImage: () => pickImages(),
  deletePages: () => deletePages(),
  deleteSelection: () => store.selectedId && E.deleteAnnotation(store.selectedId),
  escape: () => {
    if (store.selectedId) E.select(null);
    else if (store.tool !== 'select') E.setTool('select');
  },
  'tool:select': () => E.setTool('select'),
  'tool:text': () => E.setTool('text'),
  'tool:highlight': () => E.setTool('highlight'),
  'tool:eraser': () => E.setTool('eraser'),
  'tool:table': () => E.setTool('table'),
};

const NO_DOC_OK = new Set(['open', 'toggleSidebar']);

function run(command: string) {
  if (!store.doc && !NO_DOC_OK.has(command)) return;
  const fn = commands[command];
  if (fn) Promise.resolve(fn()).catch((err) => toast(describeError(err), { type: 'error' }));
}

setupKeyboard(run, platform.isElectron);

document.querySelectorAll<HTMLElement>('[data-cmd]').forEach((b) => {
  b.addEventListener('click', () => run(b.dataset.cmd!));
});
document.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => {
  b.addEventListener('click', () => run(`tool:${b.dataset.tool}`));
});
// 도구 막대 버튼이 편집 중인 글상자의 포커스를 빼앗지 않도록
$('#toolbar').addEventListener('mousedown', (e) => {
  if ((e.target as Element).closest('button')) e.preventDefault();
});

const pageInput = $<HTMLInputElement>('#page-input');
pageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const live = livePages();
    const n = Math.round(Number(pageInput.value));
    if (Number.isFinite(n) && live.length) {
      const target = live[Math.min(live.length, Math.max(1, n)) - 1];
      viewer.scrollToPage(target.index);
    }
    pageInput.blur();
  } else if (e.key === 'Escape') {
    pageInput.blur();
  }
});
pageInput.addEventListener('blur', updatePageNav);
pageInput.addEventListener('focus', () => pageInput.select());

// ---------------------------------------------------------------------------
// 끌어다 놓기 / 붙여넣기
// ---------------------------------------------------------------------------

const isPdfFile = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImageFile = (f: File) => f.type.startsWith('image/');
const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

let dragDepth = 0;
function setDropOverlay(e: DragEvent | null) {
  const overlay = $('#drop-overlay');
  if (!e) {
    overlay.classList.remove('show');
    return;
  }
  const items = Array.from(e.dataTransfer?.items ?? []);
  const hasPdf = items.some((i) => i.type === 'application/pdf');
  const hasImage = items.some((i) => i.type.startsWith('image/'));
  $('#drop-text').textContent = hasPdf
    ? 'PDF 파일을 엽니다'
    : hasImage && store.doc
      ? '놓은 위치의 페이지에 이미지를 넣습니다'
      : 'PDF는 열고, 이미지는 페이지에 넣습니다';
  overlay.classList.add('show');
}

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth += 1;
  setDropOverlay(e);
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDropOverlay(null);
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  setDropOverlay(null);
  const files = Array.from(e.dataTransfer?.files ?? []);
  const pdf = files.find(isPdfFile);
  if (pdf) {
    openWith(() => platform.readDroppedPdf(pdf));
    return;
  }
  const images = files.filter(isImageFile);
  if (!images.length) {
    if (files.length) toast('PDF 또는 이미지 파일만 넣을 수 있습니다.', { type: 'warn' });
    return;
  }
  if (!store.doc) {
    toast('먼저 PDF를 열어 주세요.', { type: 'warn' });
    return;
  }
  const view = viewer.pageAt(e.clientX, e.clientY);
  insertImages(images, view ? { view, ...viewer.pagePoint(view, e.clientX, e.clientY) } : undefined);
});

document.addEventListener('paste', (e) => {
  if (!store.doc || isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
  const files = Array.from(e.clipboardData?.items ?? [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
  if (files.length) {
    e.preventDefault();
    insertImages(files);
  }
});

// ---------------------------------------------------------------------------
// 플랫폼 연결
// ---------------------------------------------------------------------------

platform.onCommand(run);
platform.onOpenFile((file) => openWith(async () => file));
platform.onSaveAndClose(async () => {
  if (await save(false)) platform.closeConfirmed();
});

if (!platform.isElectron) {
  window.addEventListener('beforeunload', (e) => {
    if (store.doc && E.isDirty()) e.preventDefault();
  });
}

updateToolbar();
updatePageNav();
options.update();
pushDocState();
fontsReady.finally(() => platform.ready());

// 자동화 테스트용 (상태 확인 전용)
(window as unknown as { __godseon: unknown }).__godseon = { store, history: E.history };
