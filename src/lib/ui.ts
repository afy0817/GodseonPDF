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
  ImagePlus,
  Lock,
  Move,
  MousePointer2,
  PanelLeft,
  Redo2,
  Save,
  SaveAll,
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
  ImagePlus,
  Lock,
  Move,
  MousePointer2,
  PanelLeft,
  Redo2,
  Save,
  SaveAll,
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
  const close = () => {
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
  host.append(el);
  const toasts = host.querySelectorAll('.toast');
  for (let i = 0; i < toasts.length - 4; i++) toasts[i].remove();
  setTimeout(close, opts.duration ?? (opts.type === 'error' ? 7000 : 3200));
}

// ---------------------------------------------------------------------------
// 진행 표시
// ---------------------------------------------------------------------------

let busyTimer = 0;
export function setBusy(text: string | null) {
  const el = $('#busy');
  clearTimeout(busyTimer);
  if (text === null) {
    el.hidden = true;
    return;
  }
  $('#busy-text').textContent = text;
  // 금방 끝나는 작업에서는 깜빡이지 않도록 약간 늦게 보여 준다.
  busyTimer = window.setTimeout(() => (el.hidden = false), 150);
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
      <h2>암호로 보호된 PDF</h2>
      <p class="modal-desc"></p>
      <input type="password" autocomplete="off" spellcheck="false" placeholder="암호" />
      <div class="modal-actions">
        <button type="button" class="btn" data-act="cancel">취소</button>
        <button type="submit" class="btn btn-primary">열기</button>
      </div>`;
    form.querySelector('.modal-icon')!.append(icon('Lock', 22));
    form.querySelector('.modal-desc')!.textContent = incorrect
      ? '암호가 올바르지 않습니다. 다시 입력해 주세요.'
      : '이 문서를 열려면 암호가 필요합니다.';
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
