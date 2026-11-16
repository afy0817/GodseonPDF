import { t } from './i18n';
import {
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Columns3,
  createElement,
  Rows3,
  Eraser,
  FileText,
  FileUp,
  FolderOpen,
  Highlighter,
  ImageDown,
  ImagePlus,
  Languages,
  Lock,
  Move,
  MousePointer2,
  PanelLeft,
  Plus,
  Redo2,
  Replace,
  Save,
  SaveAll,
  Signature,
  Table,
  TextAlignCenter,
  TextAlignStart,
  Trash,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide';

const ICONS = {
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Columns3,
  Rows3,
  Eraser,
  FileText,
  FileUp,
  FolderOpen,
  Highlighter,
  ImageDown,
  ImagePlus,
  Languages,
  Lock,
  Move,
  MousePointer2,
  PanelLeft,
  Plus,
  Redo2,
  Replace,
  Save,
  SaveAll,
  Signature,
  Table,
  TextAlignCenter,
  TextAlignStart,
  Trash,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18): SVGElement {
  const svg = createElement(ICONS[name], { width: size, height: size, 'stroke-width': 1.75 });
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('i[data-icon]').forEach((el) => {
    const name = el.dataset.icon as IconName;
    if (ICONS[name]) el.replaceWith(icon(name));
  });
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`요소를 찾을 수 없습니다: ${selector}`);
  return el;
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// 알림(toast)
// ---------------------------------------------------------------------------

export interface ToastOptions {
  type?: 'info' | 'success' | 'warn' | 'error';
  duration?: number;
  action?: { label: string; run: () => void };
}

export function toast(message: string, opts: ToastOptions = {}) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${opts.type ?? 'info'}`;
  el.setAttribute('role', opts.type === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  let timer = 0;
  const close = () => {
    if (el.classList.contains('leaving')) return;
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 180);
  };
  if (opts.action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = opts.action.label;
    btn.addEventListener('click', () => {
      opts.action!.run();
      close();
    });
    el.append(btn);
  }
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.title = t('common.close');
  closeBtn.setAttribute('aria-label', t('common.close'));
  closeBtn.append(icon('X', 14));
  closeBtn.addEventListener('click', close);
  el.append(closeBtn);
  host.append(el);
  const toasts = host.querySelectorAll('.toast');
  for (let i = 0; i < toasts.length - 4; i++) toasts[i].remove();
  timer = window.setTimeout(close, opts.duration ?? (opts.type === 'error' ? 7000 : 3200));
}

// ---------------------------------------------------------------------------
// 진행 표시
// ---------------------------------------------------------------------------

let busyTimer = 0;
/** 진행 표시. onCancel 을 주면 '취소' 단추를 함께 보여 준다 */
export function setBusy(text: string | null, onCancel?: () => void) {
  const el = $('#busy');
  const cancel = $<HTMLButtonElement>('#busy-cancel');
  if (text === null) {
    clearTimeout(busyTimer);
    busyTimer = 0;
    el.hidden = true;
    cancel.hidden = true;
    cancel.disabled = false;
    cancel.onclick = null;
    return;
  }
  $('#busy-text').textContent = text;
  cancel.hidden = !onCancel;
  cancel.onclick = onCancel
    ? () => {
        cancel.disabled = true;
        onCancel();
      }
    : null;
  // 금방 끝나는 작업에서는 깜빡이지 않도록 약간 늦게 보여 준다 (진행 중 글자만 바뀌면 타이머는 그대로).
  if (el.hidden && !busyTimer) {
    busyTimer = window.setTimeout(() => {
      busyTimer = 0;
      el.hidden = false;
    }, 150);
  }
}

// ---------------------------------------------------------------------------
// 대화상자가 열려 있는 동안 메뉴·단축키 명령은 뒤의 문서가 아니라 대화상자로 보낸다
// ---------------------------------------------------------------------------

let modalCommands: Record<string, () => void> | null = null;

export function isModalOpen(): boolean {
  return !!document.querySelector('.modal-backdrop');
}

export function setModalCommands(commands: Record<string, () => void> | null) {
  modalCommands = commands;
}

export function runModalCommand(command: string) {
  modalCommands?.[command]?.();
}

// ---------------------------------------------------------------------------
// 암호 입력 대화상자
// ---------------------------------------------------------------------------

export function promptPassword(incorrect: boolean): Promise<string | null> {
  setBusy(null);
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const form = document.createElement('form');
    form.className = 'modal';
    form.innerHTML = `
      <div class="modal-icon"></div>
      <h2></h2>
      <p class="modal-desc"></p>
      <input type="password" autocomplete="off" spellcheck="false" />
      <div class="modal-actions">
        <button type="button" class="btn" data-act="cancel"></button>
        <button type="submit" class="btn btn-primary"></button>
      </div>`;
    form.querySelector('h2')!.textContent = t('pw.title');
    form.querySelector('input')!.placeholder = t('pw.placeholder');
    form.querySelector('[data-act="cancel"]')!.textContent = t('common.cancel');
    form.querySelector('button[type="submit"]')!.textContent = t('pw.open');
    form.querySelector('.modal-icon')!.append(icon('Lock', 22));
    form.querySelector('.modal-desc')!.textContent = t(incorrect ? 'pw.incorrect' : 'pw.desc');
    if (incorrect) form.classList.add('error');
    const input = form.querySelector('input')!;
    const done = (value: string | null) => {
      backdrop.remove();
      resolve(value);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      done(input.value);
    });
    form.querySelector('[data-act="cancel"]')!.addEventListener('click', () => done(null));
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        done(null);
      }
    });
    backdrop.append(form);
    document.body.append(backdrop);
    input.focus();
  });
}

// ---------------------------------------------------------------------------
// 문서 전체 글꼴 바꾸기 확인 (실험 기능)
// ---------------------------------------------------------------------------

export function confirmConvertFonts(): Promise<'auto' | 'sans' | 'serif' | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const form = document.createElement('form');
    form.className = 'modal modal-wide';
    form.innerHTML = `
      <div class="modal-icon warn"></div>
      <h2>${esc(t('conv.title'))} <span class="badge">${esc(t('conv.badge'))}</span></h2>
      <p class="modal-desc">${t('conv.desc1')}</p>
      <p class="modal-desc">${t('conv.desc2')}</p>
      <div class="modal-options">
        <label><input type="radio" name="mode" value="auto" checked /> ${esc(t('conv.auto'))}</label>
        <label><input type="radio" name="mode" value="sans" /> ${esc(t('conv.sans'))}</label>
        <label><input type="radio" name="mode" value="serif" /> ${esc(t('conv.serif'))}</label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="cancel">${esc(t('common.cancel'))}</button>
        <button type="submit" class="btn btn-primary">${esc(t('conv.ok'))}</button>
      </div>`;
    form.querySelector('.modal-icon')!.append(icon('Replace', 22));
    const done = (v: 'auto' | 'sans' | 'serif' | null) => {
      backdrop.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      done((new FormData(form).get('mode') as 'auto' | 'sans' | 'serif') ?? 'auto');
    });
    form.querySelector('[data-act="cancel"]')!.addEventListener('click', () => done(null));
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        done(null);
      }
    });
    backdrop.append(form);
    document.body.append(backdrop);
    (form.querySelector('button[type="submit"]') as HTMLButtonElement).focus();
  });
}

// ---------------------------------------------------------------------------
// 글꼴 모음(TTC)에서 글꼴 고르기
// ---------------------------------------------------------------------------

export function chooseFontFace<T extends { name: string }>(faces: T[]): Promise<T | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const form = document.createElement('form');
    form.className = 'modal modal-wide';
    form.innerHTML = `
      <div class="modal-icon"></div>
      <h2>${esc(t('face.title'))}</h2>
      <p class="modal-desc">${esc(t('face.desc', { n: faces.length }))}</p>
      <div class="modal-options face-list"></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="cancel">${esc(t('common.cancel'))}</button>
        <button type="submit" class="btn btn-primary">${esc(t('face.ok'))}</button>
      </div>`;
    form.querySelector('.modal-icon')!.append(icon('Type', 22));
    const list = form.querySelector('.face-list')!;
    faces.forEach((f, i) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'face';
      input.value = String(i);
      input.checked = i === 0;
      label.append(input, document.createTextNode(` ${f.name}`));
      list.append(label);
    });
    const done = (v: T | null) => {
      backdrop.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      done(faces[Number(new FormData(form).get('face') ?? 0)] ?? null);
    });
    form.querySelector('[data-act="cancel"]')!.addEventListener('click', () => done(null));
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        done(null);
      }
    });
    backdrop.append(form);
    document.body.append(backdrop);
    (form.querySelector('button[type="submit"]') as HTMLButtonElement).focus();
  });
}
