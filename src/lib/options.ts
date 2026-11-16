import * as E from './editor';
import { getAnnotation, store } from './store';
import { icon, type IconName, toast } from './ui';

const TEXT_COLORS = ['#111827', '#e5484d', '#2563eb', '#16a34a', '#f59e0b', '#ffffff'];
const HIGHLIGHT_COLORS = ['#ffe14d', '#7ff09b', '#ff9fd0', '#7fd4ff', '#ffb86b', '#c8a8ff'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96];
const COLOR_NAMES: Record<string, string> = {
  '#111827': '검정',
  '#e5484d': '빨강',
  '#2563eb': '파랑',
  '#16a34a': '초록',
  '#f59e0b': '주황',
  '#ffffff': '흰색',
  '#ffe14d': '노랑',
  '#7ff09b': '연두',
  '#ff9fd0': '분홍',
  '#7fd4ff': '하늘',
  '#ffb86b': '살구',
  '#c8a8ff': '보라',
};

type Mode = 'none' | 'select' | 'text' | 'highlight' | 'eraser' | 'image' | 'table';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function swatches(colors: string[], onPick: (c: string) => void) {
  const wrap = el('div', 'swatches');
  for (const c of colors) {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.dataset.color = c;
    b.title = COLOR_NAMES[c] ?? c;
    b.style.setProperty('--c', c);
    b.addEventListener('click', () => onPick(c));
    wrap.append(b);
  }
  const custom = el('label', 'swatch swatch-custom');
  custom.title = '다른 색';
  const input = el('input');
  input.type = 'color';
  input.addEventListener('input', () => onPick(input.value));
  custom.append(input);
  wrap.append(custom);
  return {
    wrap,
    set(color: string) {
      let matched = false;
      wrap.querySelectorAll<HTMLElement>('.swatch[data-color]').forEach((s) => {
        const on = s.dataset.color === color.toLowerCase();
        s.classList.toggle('active', on);
        matched ||= on;
      });
      custom.classList.toggle('active', !matched);
      custom.style.setProperty('--c', color);
      if (input.value !== color) input.value = color;
    },
  };
}

/** 도구/선택에 따라 바뀌는 옵션 막대 */
export class OptionsBar {
  private groups = {} as Record<Mode, HTMLElement>;
  private sizeSelect: HTMLSelectElement;
  private boldBtn: HTMLButtonElement;
  private textColors: ReturnType<typeof swatches>;
  private hlColors: ReturnType<typeof swatches>;
  private widthInput: HTMLInputElement;
  private widthValue: HTMLElement;
  private mode: Mode | null = null;
  private newTable!: HTMLElement;
  private tableEdit!: HTMLElement;
  private tableSize!: HTMLSelectElement;
  private rowsValue!: HTMLElement;
  private colsValue!: HTMLElement;
  private alignBtns!: Record<'left' | 'center', HTMLButtonElement>;
  private headerBtn!: HTMLButtonElement;

  constructor(private root: HTMLElement) {
    // 텍스트
    const text = el('div', 'opt-group');
    text.append(el('span', 'opt-title', '텍스트'));
    const sizeWrap = el('label', 'opt-field');
    sizeWrap.append(el('span', 'opt-label', '크기'));
    this.sizeSelect = el('select', 'select');
    this.sizeSelect.title = '글자 크기 (pt)';
    this.fillSizes(store.textStyle.size);
    this.sizeSelect.addEventListener('change', () => E.applyTextStyle({ size: Number(this.sizeSelect.value) }));
    sizeWrap.append(this.sizeSelect);
    this.textColors = swatches(TEXT_COLORS, (c) => E.applyTextStyle({ color: c }));
    this.boldBtn = el('button', 'icon-btn bold-btn', 'B');
    this.boldBtn.type = 'button';
    this.boldBtn.title = '굵게';
    this.boldBtn.addEventListener('click', () => E.applyTextStyle({ bold: !this.currentBold() }));
    text.append(sizeWrap, el('span', 'opt-sep'), this.textColors.wrap, el('span', 'opt-sep'), this.boldBtn, this.hint('페이지를 클릭해 입력 · Esc: 입력 끝내기'));

    // 형광펜
    const hl = el('div', 'opt-group');
    hl.append(el('span', 'opt-title', '형광펜'));
    this.hlColors = swatches(HIGHLIGHT_COLORS, (c) => E.applyHighlightStyle({ color: c }));
    const widthWrap = el('label', 'opt-field');
    widthWrap.append(el('span', 'opt-label', '굵기'));
    this.widthInput = el('input', 'range');
    this.widthInput.type = 'range';
    this.widthInput.min = '4';
    this.widthInput.max = '48';
    this.widthInput.step = '1';
    this.widthValue = el('span', 'range-value');
    this.widthInput.addEventListener('input', () => {
      this.widthValue.textContent = this.widthInput.value;
      E.applyHighlightStyle({ width: Number(this.widthInput.value) });
    });
    widthWrap.append(this.widthInput, this.widthValue);
    hl.append(this.hlColors.wrap, el('span', 'opt-sep'), widthWrap, this.hint('드래그해서 칠하기 · Shift: 직선'));

    // 지우개
    const eraser = el('div', 'opt-group');
    eraser.append(el('span', 'opt-title', '지우개'), this.hint('형광펜 위를 문지르면 지워집니다'));

    // 이미지 선택됨
    const image = el('div', 'opt-group');
    const del = el('button', 'btn btn-sm');
    del.type = 'button';
    del.append(icon('Trash', 15), el('span', '', '이미지 삭제'));
    del.addEventListener('click', () => store.selectedId && E.deleteAnnotation(store.selectedId));
    image.append(el('span', 'opt-title', '이미지'), del, this.hint('드래그: 이동 · 모서리: 크기 조절 (Shift: 비율 무시)'));

    // 선택 도구
    const select = el('div', 'opt-group');
    select.append(el('span', 'opt-title', '선택'), this.hint('클릭: 선택 · 드래그: 이동 · Delete: 삭제 · 더블클릭: 글자 수정'));

    const table = this.buildTableGroup();

    const none = el('div', 'opt-group');
    this.groups = { none, select, text, highlight: hl, eraser, image, table };
    for (const g of Object.values(this.groups)) {
      g.hidden = true;
      // 버튼을 눌러도 편집 중인 글상자의 포커스를 빼앗지 않도록
      g.addEventListener('mousedown', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('button, .swatch') && !t.closest('input, select')) e.preventDefault();
      });
      this.root.append(g);
    }
    this.update();
  }

  private iconButton(name: IconName, label: string, title: string, onClick: () => void) {
    const b = el('button', 'btn btn-sm');
    b.type = 'button';
    b.title = title;
    b.append(icon(name, 15), el('span', '', label));
    b.addEventListener('click', onClick);
    return b;
  }

  private stepper(label: string, min: number, max: number, get: () => number, set: (n: number) => void) {
    const wrap = el('span', 'opt-field stepper');
    const value = el('span', 'stepper-value');
    const minus = el('button', 'icon-btn stepper-btn', '−');
    const plus = el('button', 'icon-btn stepper-btn', '+');
    minus.type = plus.type = 'button';
    minus.title = `${label} 줄이기`;
    plus.title = `${label} 늘리기`;
    minus.addEventListener('click', () => set(Math.max(min, get() - 1)));
    plus.addEventListener('click', () => set(Math.min(max, get() + 1)));
    wrap.append(el('span', 'opt-label', label), minus, value, plus);
    return { wrap, value };
  }

  private buildTableGroup() {
    const g = el('div', 'opt-group');
    g.append(el('span', 'opt-title', '표'));

    // 새 표 크기 (표를 고르지 않았을 때)
    this.newTable = el('span', 'opt-inline');
    const rows = this.stepper('행', 1, 40, () => store.tableStyle.rows, (n) => E.applyTableStyle({ rows: n }));
    const cols = this.stepper('열', 1, 12, () => store.tableStyle.cols, (n) => E.applyTableStyle({ cols: n }));
    this.rowsValue = rows.value;
    this.colsValue = cols.value;
    this.newTable.append(rows.wrap, cols.wrap);

    // 글자 크기 (새 표 기본값 또는 선택한 표)
    const sizeWrap = el('label', 'opt-field');
    sizeWrap.append(el('span', 'opt-label', '글자'));
    this.tableSize = el('select', 'select');
    this.tableSize.title = '표 글자 크기 (pt)';
    this.tableSize.addEventListener('change', () => E.applyTableStyle({ size: Number(this.tableSize.value) }));
    sizeWrap.append(this.tableSize);

    // 선택한 표 편집
    this.tableEdit = el('span', 'opt-inline');
    const alignLeft = el('button', 'icon-btn');
    alignLeft.type = 'button';
    alignLeft.title = '왼쪽 정렬';
    alignLeft.append(icon('TextAlignStart', 16));
    alignLeft.addEventListener('click', () => E.applyTableStyle({ align: 'left' }));
    const alignCenter = el('button', 'icon-btn');
    alignCenter.type = 'button';
    alignCenter.title = '가운데 정렬';
    alignCenter.append(icon('TextAlignCenter', 16));
    alignCenter.addEventListener('click', () => E.applyTableStyle({ align: 'center' }));
    this.alignBtns = { left: alignLeft, center: alignCenter };
    this.headerBtn = el('button', 'btn btn-sm toggle', '머리글 행');
    this.headerBtn.type = 'button';
    this.headerBtn.title = '첫 행을 머리글로 (배경색 + 굵게)';
    this.headerBtn.addEventListener('click', () => {
      const a = getAnnotation(store.selectedId);
      if (a?.type === 'table') E.applyTableStyle({ header: !a.header });
    });
    const cannot = (what: string) => toast(`표에는 ${what}이 하나 이상 있어야 합니다.`, { type: 'warn' });
    this.tableEdit.append(
      alignLeft,
      alignCenter,
      this.headerBtn,
      el('span', 'opt-sep'),
      this.iconButton('BetweenHorizontalEnd', '행 추가', '현재 칸 아래에 행 추가', () => E.tableCommand('rowBelow')),
      this.iconButton('Rows3', '행 삭제', '현재 칸의 행 삭제', () => E.tableCommand('deleteRow') || cannot('행')),
      this.iconButton('BetweenVerticalEnd', '열 추가', '현재 칸 오른쪽에 열 추가', () => E.tableCommand('colRight')),
      this.iconButton('Columns3', '열 삭제', '현재 칸의 열 삭제', () => E.tableCommand('deleteCol') || cannot('열')),
      el('span', 'opt-sep'),
      this.iconButton('Trash', '표 삭제', '표 삭제 (Delete)', () => store.selectedId && E.deleteAnnotation(store.selectedId)),
    );
    const newHint = this.hint('페이지를 클릭해 표 넣기');
    const editHint = this.hint('칸 클릭: 입력 · Tab: 다음 칸 · 선 끌기: 크기 조절');
    newHint.classList.add('when-new');
    editHint.classList.add('when-edit');
    g.append(this.newTable, el('span', 'opt-sep when-new'), sizeWrap, this.tableEdit, newHint, editHint);
    return g;
  }

  private hint(text: string) {
    return el('span', 'opt-hint', text);
  }

  private fillSizes(current: number) {
    const sizes = SIZES.includes(current) ? SIZES : [...SIZES, current].sort((a, b) => a - b);
    this.sizeSelect.replaceChildren(
      ...sizes.map((s) => {
        const o = el('option', '', `${s}`);
        o.value = String(s);
        return o;
      }),
    );
    this.sizeSelect.value = String(current);
  }

  private currentBold() {
    const a = getAnnotation(store.selectedId);
    return a?.type === 'text' ? a.bold : store.textStyle.bold;
  }

  update() {
    const sel = getAnnotation(store.selectedId);
    let mode: Mode;
    if (!store.doc) mode = 'none';
    else if (sel?.type === 'text') mode = 'text';
    else if (sel?.type === 'highlight') mode = 'highlight';
    else if (sel?.type === 'image') mode = 'image';
    else if (sel?.type === 'table') mode = 'table';
    else if (store.tool === 'table') mode = 'table';
    else if (store.tool === 'text') mode = 'text';
    else if (store.tool === 'highlight') mode = 'highlight';
    else if (store.tool === 'eraser') mode = 'eraser';
    else mode = 'select';

    if (mode !== this.mode) {
      for (const [k, g] of Object.entries(this.groups)) g.hidden = k !== mode;
      this.mode = mode;
    }
    if (mode === 'text') {
      const t = sel?.type === 'text' ? sel : store.textStyle;
      if (this.sizeSelect.value !== String(t.size)) this.fillSizes(t.size);
      this.textColors.set(t.color);
      this.boldBtn.classList.toggle('active', t.bold);
    } else if (mode === 'table') {
      const t = sel?.type === 'table' ? sel : null;
      const g = this.groups.table;
      g.classList.toggle('editing-table', !!t);
      this.newTable.hidden = !!t;
      this.tableEdit.hidden = !t;
      this.rowsValue.textContent = String(store.tableStyle.rows);
      this.colsValue.textContent = String(store.tableStyle.cols);
      const size = t ? t.size : store.tableStyle.size;
      const sizes = SIZES.includes(size) ? SIZES : [...SIZES, size].sort((a, b) => a - b);
      if (this.tableSize.options.length !== sizes.length || this.tableSize.value !== String(size)) {
        this.tableSize.replaceChildren(
          ...sizes.map((n) => {
            const o = el('option', '', String(n));
            o.value = String(n);
            return o;
          }),
        );
        this.tableSize.value = String(size);
      }
      if (t) {
        this.alignBtns.left.classList.toggle('active', t.align === 'left');
        this.alignBtns.center.classList.toggle('active', t.align === 'center');
        this.headerBtn.classList.toggle('active', t.header);
      }
    } else if (mode === 'highlight') {
      const h = sel?.type === 'highlight' ? sel : store.highlightStyle;
      this.hlColors.set(h.color);
      this.widthInput.value = String(h.width);
      this.widthValue.textContent = String(h.width);
    }
  }
}
