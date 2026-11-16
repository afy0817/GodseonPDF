import { convertDocumentFonts } from './lib/convert';
import * as E from './lib/editor';
import { chooseImageExport } from './lib/exportDialog';
import { exportPdf } from './lib/exporter';
import { ExportCancelled, renderPageImages, safeName } from './lib/imageExport';
import { loadFonts } from './lib/fonts';
import { loadImageFile, makeImageAnnotation, reencodeAsPng } from './lib/images';
import { setupInteractions } from './lib/interactions';
import { isEditableTarget, setupKeyboard } from './lib/keyboard';
import { OptionsBar } from './lib/options';
import { showRunHover } from './lib/overlay';
import { loadPdf, PasswordCancelled } from './lib/pdf';
import { applyI18n, getLang, onLangChange, setLang, t } from './lib/i18n';
import * as platform from './lib/platform';
import { emit, getAnnotation, livePages, on, store } from './lib/store';
import { openSignaturePad } from './lib/signaturePad';
import { SIGNATURE_DRAG_TYPE, SignatureDrawer, type Signature } from './lib/signatures';
import { clearTextRuns } from './lib/textRuns';
import { Thumbnails } from './lib/thumbnails';
import type { ImageAnnotation, ImageAsset, OpenedFile } from './lib/types';
import {
  $,
  chooseFontFace,
  confirmConvertFonts,
  describeError,
  hydrateIcons,
  isModalOpen,
  promptPassword,
  runModalCommand,
  setBusy,
  toast,
} from './lib/ui';
import { addFont, loadSavedFonts, readFontFile, removeUserFont, USER_PREFIX, userFont } from './lib/userFonts';
import { Viewer, type PageView } from './lib/viewer';
import { ZipTooLargeError, ZipWriter } from './lib/zip';

setLang(platform.initialLanguage());
document.documentElement.lang = getLang();
applyI18n();
hydrateIcons();
document.documentElement.dataset.os = platform.os;
document.documentElement.classList.toggle('electron', platform.isElectron);

const app = $('#app');
const viewer = new Viewer($('#viewer'), $('#pages'));
const thumbs = new Thumbnails($('#thumbs'), viewer, (indices) => deletePages(indices));
const options = new OptionsBar($('#options'), {
  convertFonts: () => run('convertFonts'),
  addFont: () => pickFont(),
  removeFont: (id) => void removeFont(id),
});
const fontsReady = loadFonts()
  .catch((err) => {
    console.error(err);
    toast(t('toast.fontsFailed'), { type: 'error' });
  })
  .then(() => loadSavedFonts())
  .catch((err) => console.warn(err))
  .finally(() => options.update());

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
  title.textContent = doc ? doc.name : 'GodseonPDF';
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
  if (store.tool !== 'edit') showRunHover(null, null);
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
  setBusy(t('busy.opening'));
  try {
    const loaded = await loadPdf(file.data, promptPassword);
    closeDocument();
    clearTextRuns();
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
      toast(t('toast.openFailed', { msg: describeError(err) }), { type: 'error' });
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
    toast(t('toast.fileOpenFailed', { msg: describeError(err) }), { type: 'error' });
    return;
  }
  if (file) await loadDocument(file);
}

// ---------------------------------------------------------------------------
// 저장
// ---------------------------------------------------------------------------

let saving = false;

/** 편집 내용을 넣은 PDF 를 만든다 (저장·이미지로 내보내기 공용) */
async function buildPdf() {
  const doc = store.doc!;
  await fontsReady;
  return exportPdf({
    bytes: doc.bytes,
    password: doc.password,
    pages: doc.pages,
    deleted: store.deleted,
    annotations: store.annotations,
    images: store.images,
    reencodeImage: reencodeAsPng,
  });
}

function warnMissingChars(chars: string[]) {
  if (chars.length) toast(t('toast.missingChars', { chars: chars.slice(0, 12).join(' ') }), { type: 'warn', duration: 8000 });
}

async function save(forceDialog: boolean): Promise<boolean> {
  const doc = store.doc;
  if (!doc || saving) return false;
  E.finishEditing();
  saving = true;
  setBusy(t('busy.saving'));
  try {
    const result = await buildPdf();
    setBusy(null);
    const suggested = /\.pdf$/i.test(doc.name) ? doc.name : `${doc.name}.pdf`;
    const saved = await platform.save(doc.path, result.bytes, suggested, forceDialog);
    if (!saved) return false;
    doc.name = saved.name;
    if (saved.path) doc.path = saved.path;
    E.history.markSaved();
    emit('history');
    pushDocState();
    toast(t(platform.isElectron ? 'toast.saved' : 'toast.downloaded', { name: saved.name }), { type: 'success' });
    warnMissingChars(result.missingChars);
    if (result.coveredOnly) {
      toast(t('toast.coveredOnly', { n: result.coveredOnly }), {
        type: 'info',
        duration: 8000,
      });
    }
    if (result.encryption === 'removed') {
      toast(t('toast.encRemoved'), { type: 'info', duration: 7000 });
    } else if (result.encryption === 'kept') {
      toast(t('toast.encKept'), { type: 'info' });
    }
    return true;
  } catch (err) {
    console.error(err);
    toast(t('toast.saveFailed', { msg: describeError(err) }), { type: 'error', duration: 9000 });
    return false;
  } finally {
    saving = false;
    setBusy(null);
  }
}

// ---------------------------------------------------------------------------
// 이미지로 내보내기: 고른 페이지(또는 전체)를 PNG·JPG 로. 여러 장이면 ZIP 하나 또는 폴더에 낱장으로.
// 저장한 PDF 와 같은 결과(편집 내용 포함, 지운 페이지 제외)를 그린다.
// ---------------------------------------------------------------------------

let exporting = false;

async function exportImages() {
  const doc = store.doc;
  if (!doc || exporting) return;
  E.finishEditing();
  const live = livePages();
  const posOf = new Map(live.map((p, i) => [p.index, i + 1]));
  const selected = [...store.pageSelection]
    .map((i) => posOf.get(i))
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b);
  const choice = await chooseImageExport({
    selected,
    current: posOf.get(store.currentPage) ?? 1,
    total: live.length,
    sizeOf: (n) => live[n - 1],
    canFolder: platform.isElectron,
  });
  if (!choice || exporting || store.doc !== doc) return;

  const base = safeName(doc.name.replace(/\.pdf$/i, ''));
  const digits = Math.max(2, String(live.length).length);
  const imageName = (n: number) => `${base}_p${String(n).padStart(digits, '0')}.${choice.format}`;
  const single = choice.pages.length === 1;
  const mode = !single && choice.output === 'folder' ? 'folder' : 'file';
  const name = single ? imageName(choice.pages[0]) : mode === 'folder' ? `${base}_images` : `${base}_images.zip`;

  exporting = true;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let target: platform.ExportTarget | null = null;
  try {
    // 저장할 곳을 먼저 고르고(대화상자), 그다음 한 장씩 그려서 바로 쓴다
    target = await platform.beginExport(mode, name, single ? choice.format : 'zip', doc.path);
    if (!target) return;
    const out = target;
    setBusy(t('busy.exportPreparing'), cancel);
    const pdf = await buildPdf();
    if (controller.signal.aborted) throw new ExportCancelled();
    const zip = mode === 'file' && !single ? new ZipWriter((chunks) => out.append(chunks)) : null;
    await renderPageImages({
      pdfBytes: pdf.bytes,
      password: doc.password,
      pageIndexes: choice.pages.map((n) => n - 1),
      format: choice.format,
      dpi: choice.dpi,
      signal: controller.signal,
      onProgress: (done, total) => setBusy(t('busy.exportProgress', { done, total }), cancel),
      onImage: async (index, data) => {
        if (zip) await zip.add(imageName(index + 1), data);
        else if (mode === 'folder') await out.writeFile(imageName(index + 1), data);
        else await out.append([data]);
      },
    });
    await zip?.finish();
    target = null;
    const saved = await out.finish();
    setBusy(null);
    const n = choice.pages.length;
    const message = !platform.isElectron
      ? t('toast.downloaded', { name: saved.name })
      : single
        ? t('toast.imageSaved', { name: saved.name })
        : t(mode === 'folder' ? 'toast.imagesFolder' : 'toast.imagesZip', { n, name: saved.name });
    const where = saved.path;
    toast(message, {
      type: 'success',
      duration: where ? 8000 : undefined,
      action: where
        ? { label: t(mode === 'folder' ? 'action.openFolder' : 'action.showInFolder'), run: () => platform.revealExport(where) }
        : undefined,
    });
    warnMissingChars(pdf.missingChars);
  } catch (err) {
    await target?.abort().catch(() => {});
    if (err instanceof ExportCancelled || controller.signal.aborted) {
      toast(t('toast.exportCancelled'));
    } else {
      console.error(err);
      const msg = err instanceof ZipTooLargeError ? t('toast.zipTooLarge') : t('toast.exportFailed', { msg: describeError(err) });
      toast(msg, { type: 'error', duration: 9000 });
    }
  } finally {
    exporting = false;
    setBusy(null);
  }
}

// ---------------------------------------------------------------------------
// 서명: 그려서 서랍에 모아 두고, 끌어서 놓거나 눌러서 넣는다
// ---------------------------------------------------------------------------

const drawer = new SignatureDrawer($('#sig-list'), (sig) => void insertSignature(sig));
const DRAWER_KEY = 'godseon.drawerOpen';
const SIGNATURE_BOX = { w: 140, h: 50 }; // 처음 넣을 때 크기 (pt) — 넣은 뒤 모서리로 조절
const signatureAssets = new Map<string, ImageAsset>();

function setDrawerOpen(open: boolean) {
  app.classList.toggle('drawer-open', open);
  $('#sig-toggle').setAttribute('aria-pressed', String(open));
  try {
    localStorage.setItem(DRAWER_KEY, open ? '1' : '0');
  } catch {
    /* 기억하지 못해도 괜찮다 */
  }
  if (open) void drawer.load();
}

async function insertSignature(sig: Pick<Signature, 'id' | 'bytes'>, drop?: { view: PageView; x: number; y: number }) {
  if (!store.doc) {
    toast(t('toast.openFirst'), { type: 'warn' });
    return;
  }
  E.finishEditing();
  const view = drop?.view ?? viewer.views[store.currentPage];
  if (!view) return;
  // 같은 서명은 이미지 하나를 같이 쓴다 (저장한 PDF 에도 한 번만 들어간다)
  let asset = signatureAssets.get(sig.id);
  if (!asset || store.images.get(asset.id) !== asset) {
    asset = await loadImageFile(new Blob([sig.bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    signatureAssets.set(sig.id, asset);
    store.images.set(asset.id, asset);
  }
  const at = drop ?? viewer.visibleCenter(view);
  E.setTool('select');
  E.addAnnotations([makeImageAnnotation(asset, view.info, at, SIGNATURE_BOX)]);
}

async function newSignature() {
  E.finishEditing();
  const result = await openSignaturePad({ canInsert: !!store.doc });
  if (!result) return;
  setDrawerOpen(true);
  let sig: Pick<Signature, 'id' | 'bytes'>;
  try {
    sig = await drawer.add(result.png);
    if (!result.insert) toast(t('toast.sigSaved'), { type: 'success' });
  } catch (err) {
    console.error(err);
    toast(t('toast.sigSaveFailed', { msg: describeError(err) }), { type: 'error', duration: 8000 });
    sig = { id: `unsaved-${Date.now()}`, bytes: result.png }; // 서랍에 못 넣어도 문서에는 넣는다
  }
  if (result.insert) await insertSignature(sig);
}

// 서랍에서 페이지로 끌어다 놓기
const hasSignature = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(SIGNATURE_DRAG_TYPE);
let dropPage: HTMLElement | null = null;
function markDropPage(el: HTMLElement | null) {
  if (dropPage === el) return;
  dropPage?.classList.remove('drop-target');
  el?.classList.add('drop-target');
  dropPage = el;
}
const viewerEl = $('#viewer');
viewerEl.addEventListener('dragover', (e) => {
  if (!hasSignature(e)) return;
  const view = store.doc && !isModalOpen() ? viewer.pageAt(e.clientX, e.clientY) : undefined;
  markDropPage(view?.el ?? null);
  if (!view) return; // 페이지 밖: 놓을 수 없음
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
});
viewerEl.addEventListener('dragleave', (e) => {
  if (hasSignature(e) && !viewerEl.contains(e.relatedTarget as Node | null)) markDropPage(null);
});
viewerEl.addEventListener('drop', (e) => {
  if (!hasSignature(e)) return;
  e.preventDefault();
  markDropPage(null);
  const sig = drawer.get(e.dataTransfer!.getData(SIGNATURE_DRAG_TYPE));
  const view = viewer.pageAt(e.clientX, e.clientY);
  if (sig && view) void insertSignature(sig, { view, ...viewer.pagePoint(view, e.clientX, e.clientY) });
});
document.addEventListener('dragend', () => markDropPage(null));

try {
  if (localStorage.getItem(DRAWER_KEY) === '1') setDrawerOpen(true);
} catch {
  /* 무시 */
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
      toast(`${file.name || t('image.fallbackName')}: ${describeError(err)}`, { type: 'error' });
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
  if (n === -1) toast(t('toast.cannotDeleteAll'), { type: 'warn' });
  else if (n > 0) toast(t('toast.pagesDeleted', { n }), { action: { label: t('action.undo'), run: () => E.undo() } });
}

// ---------------------------------------------------------------------------
// 사용자 글꼴 추가 / 지우기
// ---------------------------------------------------------------------------

const fontInput = $<HTMLInputElement>('#font-input');
fontInput.addEventListener('change', async () => {
  const file = fontInput.files?.[0];
  fontInput.value = '';
  if (!file) return;
  try {
    await fontsReady;
    const faces = await readFontFile(file);
    const face = faces.length > 1 ? await chooseFontFace(faces) : faces[0];
    if (!face) return;
    const uf = await addFont(face);
    E.applyTextStyle({ font: USER_PREFIX + uf.id });
    options.update();
    toast(t('toast.fontAdded', { name: uf.name }), { type: 'success' });
    if (!face.embeddable) toast(t('toast.fontNoEmbed'), { type: 'warn', duration: 9000 });
  } catch (err) {
    console.error(err);
    toast(t('toast.fontAddFailed', { msg: describeError(err) }), { type: 'error' });
  }
});

function pickFont() {
  fontInput.click();
}

async function removeFont(id: string) {
  const name = userFont(USER_PREFIX + id)?.name ?? '';
  try {
    await removeUserFont(id);
  } catch (err) {
    toast(describeError(err), { type: 'error' });
    return;
  }
  if (store.textStyle.font === USER_PREFIX + id) store.textStyle.font = 'sans';
  E.refresh(null); // 이 글꼴을 쓰던 글상자는 나눔고딕으로 보인다
  options.update();
  toast(t('toast.fontRemoved', { name }));
}

// ---------------------------------------------------------------------------
// 문서 전체 글꼴 바꾸기 (실험 기능)
// ---------------------------------------------------------------------------

async function convertFonts() {
  if (!store.doc) return;
  E.finishEditing();
  const mode = await confirmConvertFonts();
  if (!mode) return;
  setBusy(t('busy.converting'));
  try {
    await fontsReady;
    const n = await convertDocumentFonts(viewer, mode, (done, total) => setBusy(t('busy.convertingProgress', { done, total })));
    if (n) {
      E.setTool('select');
      toast(t('toast.converted', { n }), {
        type: 'success',
        duration: 9000,
        action: { label: t('action.undo'), run: () => E.undo() },
      });
    } else {
      toast(t('toast.convertNone'), { type: 'warn' });
    }
  } catch (err) {
    console.error(err);
    toast(t('toast.convertFailed', { msg: describeError(err) }), { type: 'error' });
  } finally {
    setBusy(null);
  }
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
  exportImages: () => exportImages(),
  toggleSignatures: () => setDrawerOpen(!app.classList.contains('drawer-open')),
  newSignature: () => newSignature(),
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
  'tool:edit': () => E.setTool('edit'),
  toggleLanguage: () => {
    const next = getLang() === 'ko' ? 'en' : 'ko';
    setLang(next);
    platform.saveLanguage(next);
  },
  convertFonts: () => convertFonts(),
};

const NO_DOC_OK = new Set(['open', 'toggleSidebar', 'toggleLanguage', 'toggleSignatures', 'newSignature']);

function run(command: string) {
  // 대화상자가 열려 있으면 메뉴·단축키는 뒤의 문서 대신 대화상자로 (예: 서명 그리기의 획 되돌리기)
  if (isModalOpen()) {
    runModalCommand(command);
    return;
  }
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
    ? t('drop.pdf')
    : hasImage && store.doc
      ? t('drop.image')
      : t('drop.any');
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
    if (files.length) toast(t('toast.onlyPdfImage'), { type: 'warn' });
    return;
  }
  if (!store.doc) {
    toast(t('toast.openFirst'), { type: 'warn' });
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
platform.onLanguage((lang) => setLang(lang));

// 언어가 바뀌면 화면 문구를 모두 다시 넣는다 (열린 문서와 편집 내용은 그대로)
onLangChange(() => {
  applyI18n();
  options.rebuild();
  document.querySelectorAll<HTMLElement>('.thumb-del').forEach((b) => (b.title = t('thumb.delete')));
  document.querySelectorAll<HTMLElement>('.ann-del').forEach((b) => (b.title = t('ann.delete')));
  document.querySelectorAll<HTMLElement>('.ann-text-body').forEach((b) => (b.dataset.placeholder = t('ann.placeholder')));
  document.querySelectorAll<HTMLElement>('.tbl-grip').forEach((b) => (b.title = t('table.grip')));
  document.querySelectorAll<HTMLElement>('.cover-rect').forEach((el) => {
    const a = getAnnotation(el.dataset.id ?? null);
    if (a?.type === 'text') el.title = t('cover.title', { text: a.original ?? '' });
  });
  if (drawer.items.length || app.classList.contains('drawer-open')) drawer.render();
  updatePageNav();
});
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
(window as unknown as { __godseon: unknown }).__godseon = { store, history: E.history, drawer };
