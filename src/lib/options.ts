import * as E from './editor';
import { type Key, t } from './i18n';
import { getAnnotation, store } from './store';
import { icon, type IconName, toast } from './ui';
import { isUserFontId, listUserFonts, USER_PREFIX, userFont, userFontsVersion } from './userFonts';

const TEXT_COLORS = ['#111827', '#e5484d', '#2563eb', '#16a34a', '#f59e0b', '#ffffff'];
const HIGHLIGHT_COLORS = ['#ffe14d', '#7ff09b', '#ff9fd0', '#7fd4ff', '#ffb86b', '#c8a8ff'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96];
const COLOR_NAMES: Record<string, Key> = {
  '#111827': 'color.black',
  '#e5484d': 'color.red',
  '#2563eb': 'color.blue',
  '#16a34a': 'color.green',
  '#f59e0b': 'color.orange',
  '#ffffff': 'color.white',
  '#ffe14d': 'color.yellow',
  '#7ff09b': 'color.lime',
  '#ff9fd0': 'color.pink',
  '#7fd4ff': 'color.sky',
  '#ffb86b': 'color.peach',
  '#c8a8ff': 'color.purple',
};

type Mode = 'none' | 'select' | 'text' | 'highlight' | 'eraser' | 'image' | 'table' | 'edit';

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
    b.title = COLOR_NAMES[c] ? t(COLOR_NAMES[c]) : c;
    b.style.setProperty('--c', c);
    b.addEventListener('click', () => onPick(c));
    wrap.append(b);
  }
  const custom = el('label', 'swatch swatch-custom');
  custom.title = t('opt.otherColor');
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

function sizeOptions(select: HTMLSelectElement, current: number) {
  const sizes = SIZES.includes(current) ? SIZES : [...SIZES, current].sort((a, b) => a - b);
  if (select.options.length === sizes.length && select.value === String(current)) return;
  select.replaceChildren(
    ...sizes.map((s) => {
      const o = el('option', '', String(s));
      o.value = String(s);
      return o;
    }),
  );
  select.value = String(current);
}

/** 도구/선택에 따라 바뀌는 옵션 막대 */
export class OptionsBar {
  private groups = {} as Record<Mode, HTMLElement>;
  private mode: Mode | null = null;
  // 텍스트
  private sizeSelect!: HTMLSelectElement;
  private boldBtn!: HTMLButtonElement;
  private textColors!: ReturnType<typeof swatches>;
  private fontSelect!: HTMLSelectElement;
  private fontRemoveBtn!: HTMLButtonElement;
  private fontListVersion = -1;
  private restoreBtn!: HTMLButtonElement;
  private textHint!: HTMLElement;
  // 형광펜
  private hlColors!: ReturnType<typeof swatches>;
  private widthInput!: HTMLInputElement;
  private widthValue!: HTMLElement;
  // 표
  private newTable!: HTMLElement;
  private tableEdit!: HTMLElement;
  private tableSize!: HTMLSelectElement;
  private rowsValue!: HTMLElement;
  private colsValue!: HTMLElement;
  private alignBtns!: Record<'left' | 'center', HTMLButtonElement>;
  private headerBtn!: HTMLButtonElement;

  constructor(
    private root: HTMLElement,
    private hooks: { convertFonts(): void; addFont(): void; removeFont(id: string): void },
  ) {
    this.build();
    this.update();
  }

  /** 언어를 바꾸면 문구를 새로 넣어 다시 만든다 */
  rebuild() {
    this.root.replaceChildren();
    this.mode = null;
    this.build();
    this.update();
  }

  private build() {
    const groups: Record<Mode, HTMLElement> = {
      none: el('div', 'opt-group'),
      select: this.group('opt.select', this.hint(t('opt.select.hint'))),
      text: this.buildTextGroup(),
      highlight: this.buildHighlightGroup(),
      eraser: this.group('opt.eraser', this.hint(t('opt.eraser.hint'))),
      image: this.group(
        'opt.image',
        this.iconButton('Trash', t('opt.image.delete'), t('opt.image.delete'), () => store.selectedId && E.deleteAnnotation(store.selectedId)),
        this.hint(t('opt.image.hint')),
      ),
      table: this.buildTableGroup(),
      edit: this.group(
        'opt.edit',
        this.iconButton('Replace', t('opt.convert'), t('opt.convert.title'), () => this.hooks.convertFonts()),
        this.hint(t('opt.edit.hint')),
      ),
    };
    this.groups = groups;
    for (const g of Object.values(groups)) {
      g.hidden = true;
      // 버튼을 눌러도 편집 중인 글상자의 포커스를 빼앗지 않도록
      g.addEventListener('mousedown', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, .swatch') && !target.closest('input, select')) e.preventDefault();
      });
      this.root.append(g);
    }
  }

  private group(title: Key, ...children: HTMLElement[]) {
    const g = el('div', 'opt-group');
    g.append(el('span', 'opt-title', t(title)), ...children);
    return g;
  }

  private hint(text: string) {
    return el('span', 'opt-hint', text);
  }

  private iconButton(name: IconName, label: string, title: string, onClick: () => void) {
    const b = el('button', 'btn btn-sm');
    b.type = 'button';
    b.title = title;
    b.append(icon(name, 15), el('span', '', label));
    b.addEventListener('click', onClick);
    return b;
  }

  private stepper(label: Key, decTitle: Key, incTitle: Key, min: number, max: number, get: () => number, set: (n: number) => void) {
    const wrap = el('span', 'opt-field stepper');
    const value = el('span', 'stepper-value');
    const minus = el('button', 'icon-btn stepper-btn', '−');
    const plus = el('button', 'icon-btn stepper-btn', '+');
    minus.type = plus.type = 'button';
    minus.title = t(decTitle);
    plus.title = t(incTitle);
    minus.addEventListener('click', () => set(Math.max(min, get() - 1)));
    plus.addEventListener('click', () => set(Math.min(max, get() + 1)));
    wrap.append(el('span', 'opt-label', t(label)), minus, value, plus);
    return { wrap, value };
  }

  private buildTextGroup() {
    const sizeWrap = el('label', 'opt-field');
    sizeWrap.append(el('span', 'opt-label', t('opt.size')));
    this.sizeSelect = el('select', 'select');
    this.sizeSelect.title = t('opt.size.title');
    sizeOptions(this.sizeSelect, store.textStyle.size);
    this.sizeSelect.addEventListener('change', () => E.applyTextStyle({ size: Number(this.sizeSelect.value) }));
    sizeWrap.append(this.sizeSelect);

    // 글꼴: 나눔고딕 · 나눔명조 · 사용자가 추가한 글꼴 · 글꼴 추가…
    const fontWrap = el('span', 'opt-field');
    this.fontSelect = el('select', 'select font-select');
    this.fontSelect.title = t('opt.font.title');
    this.fontListVersion = -1;
    this.fontSelect.addEventListener('change', () => {
      const value = this.fontSelect.value;
      if (value === '__add__') {
        this.update();
        this.hooks.addFont();
        return;
      }
      E.applyTextStyle({ font: value });
    });
    this.fontRemoveBtn = el('button', 'icon-btn');
    this.fontRemoveBtn.type = 'button';
    this.fontRemoveBtn.title = t('opt.font.remove');
    this.fontRemoveBtn.append(icon('Trash', 15));
    this.fontRemoveBtn.addEventListener('click', () => {
      const font = this.currentFont();
      if (isUserFontId(font)) this.hooks.removeFont(font.slice(USER_PREFIX.length));
    });
    fontWrap.append(this.fontSelect, this.fontRemoveBtn);
    this.textColors = swatches(TEXT_COLORS, (c) => E.applyTextStyle({ color: c }));
    this.boldBtn = el('button', 'icon-btn bold-btn', 'B');
    this.boldBtn.type = 'button';
    this.boldBtn.title = t('opt.bold');
    this.boldBtn.addEventListener('click', () => {
      const a = getAnnotation(store.selectedId);
      E.applyTextStyle({ bold: !(a?.type === 'text' ? a.bold : store.textStyle.bold) });
    });
    this.restoreBtn = this.iconButton('Undo2', t('opt.restore'), t('opt.restore.title'), () => {
      if (store.selectedId) E.deleteAnnotation(store.selectedId);
    });
    this.textHint = this.hint('');
    return this.group(
      'opt.text',
      sizeWrap,
      fontWrap,
      el('span', 'opt-sep'),
      this.textColors.wrap,
      el('span', 'opt-sep'),
      this.boldBtn,
      this.restoreBtn,
      this.textHint,
    );
  }

  private buildHighlightGroup() {
    this.hlColors = swatches(HIGHLIGHT_COLORS, (c) => E.applyHighlightStyle({ color: c }));
    const widthWrap = el('label', 'opt-field');
    widthWrap.append(el('span', 'opt-label', t('opt.width')));
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
    return this.group('opt.highlight', this.hlColors.wrap, el('span', 'opt-sep'), widthWrap, this.hint(t('opt.highlight.hint')));
  }

  private buildTableGroup() {
    // 새 표 크기 (표를 고르지 않았을 때)
    this.newTable = el('span', 'opt-inline');
    const rows = this.stepper('opt.rows', 'opt.rows.dec', 'opt.rows.inc', 1, 40, () => store.tableStyle.rows, (n) => E.applyTableStyle({ rows: n }));
    const cols = this.stepper('opt.cols', 'opt.cols.dec', 'opt.cols.inc', 1, 12, () => store.tableStyle.cols, (n) => E.applyTableStyle({ cols: n }));
    this.rowsValue = rows.value;
    this.colsValue = cols.value;
    this.newTable.append(rows.wrap, cols.wrap);

    // 글자 크기 (새 표 기본값 또는 선택한 표)
    const sizeWrap = el('label', 'opt-field');
    sizeWrap.append(el('span', 'opt-label', t('opt.tableFont')));
    this.tableSize = el('select', 'select');
    this.tableSize.title = t('opt.tableFont.title');
    this.tableSize.addEventListener('change', () => E.applyTableStyle({ size: Number(this.tableSize.value) }));
    sizeWrap.append(this.tableSize);

    // 선택한 표 편집
    this.tableEdit = el('span', 'opt-inline');
    const alignBtn = (align: 'left' | 'center', iconName: IconName, title: Key) => {
      const b = el('button', 'icon-btn');
      b.type = 'button';
      b.title = t(title);
      b.append(icon(iconName, 16));
      b.addEventListener('click', () => E.applyTableStyle({ align }));
      return b;
    };
    this.alignBtns = { left: alignBtn('left', 'TextAlignStart', 'opt.alignLeft'), center: alignBtn('center', 'TextAlignCenter', 'opt.alignCenter') };
    this.headerBtn = el('button', 'btn btn-sm toggle', t('opt.headerRow'));
    this.headerBtn.type = 'button';
    this.headerBtn.title = t('opt.headerRow.title');
    this.headerBtn.addEventListener('click', () => {
      const a = getAnnotation(store.selectedId);
      if (a?.type === 'table') E.applyTableStyle({ header: !a.header });
    });
    const warn = (key: Key) => toast(t(key), { type: 'warn' });
    this.tableEdit.append(
      this.alignBtns.left,
      this.alignBtns.center,
      this.headerBtn,
      el('span', 'opt-sep'),
      this.iconButton('BetweenHorizontalEnd', t('opt.rowAdd'), t('opt.rowAdd.title'), () => E.tableCommand('rowBelow')),
      this.iconButton('Rows3', t('opt.rowDel'), t('opt.rowDel.title'), () => E.tableCommand('deleteRow') || warn('opt.needRow')),
      this.iconButton('BetweenVerticalEnd', t('opt.colAdd'), t('opt.colAdd.title'), () => E.tableCommand('colRight')),
      this.iconButton('Columns3', t('opt.colDel'), t('opt.colDel.title'), () => E.tableCommand('deleteCol') || warn('opt.needCol')),
      el('span', 'opt-sep'),
      this.iconButton('Trash', t('opt.tableDel'), t('opt.tableDel.title'), () => store.selectedId && E.deleteAnnotation(store.selectedId)),
    );
    const newHint = this.hint(t('opt.table.newHint'));
    const editHint = this.hint(t('opt.table.editHint'));
    newHint.classList.add('when-new');
    editHint.classList.add('when-edit');
    const sep = el('span', 'opt-sep when-new');
    return this.group('opt.table', this.newTable, sep, sizeWrap, this.tableEdit, newHint, editHint);
  }

  private currentFont(): string {
    const sel = getAnnotation(store.selectedId);
    return (sel?.type === 'text' ? sel.font : store.textStyle.font) ?? 'sans';
  }

  /** 글꼴 목록 다시 채우기 (사용자 글꼴이 늘거나 줄었을 때만) */
  private syncFontOptions() {
    if (this.fontListVersion === userFontsVersion()) return;
    this.fontListVersion = userFontsVersion();
    const opt = (value: string, label: string) => {
      const o = el('option', '', label);
      o.value = value;
      return o;
    };
    const items: HTMLElement[] = [opt('sans', t('opt.font.sans.title')), opt('serif', t('opt.font.serif.title'))];
    const users = listUserFonts();
    if (users.length) {
      const group = el('optgroup');
      group.label = t('opt.font.userGroup');
      for (const uf of users) group.append(opt(USER_PREFIX + uf.id, uf.name));
      items.push(group);
    }
    items.push(opt('__add__', t('opt.font.add')));
    this.fontSelect.replaceChildren(...items);
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
    else if (store.tool === 'edit') mode = 'edit';
    else mode = 'select';

    if (mode !== this.mode) {
      for (const [k, g] of Object.entries(this.groups)) g.hidden = k !== mode;
      this.mode = mode;
    }
    if (mode === 'text') {
      const st = sel?.type === 'text' ? sel : store.textStyle;
      sizeOptions(this.sizeSelect, st.size);
      this.textColors.set(st.color);
      this.boldBtn.classList.toggle('active', st.bold);
      this.syncFontOptions();
      const font = this.currentFont();
      // 지운 사용자 글꼴을 쓰던 글상자는 나눔고딕으로 보인다
      this.fontSelect.value = isUserFontId(font) && !userFont(font) ? 'sans' : font === 'serif' || userFont(font) ? font : 'sans';
      this.fontRemoveBtn.hidden = !userFont(font);
      const replaced = sel?.type === 'text' && !!sel.cover;
      this.restoreBtn.hidden = !replaced;
      this.textHint.textContent = replaced ? t('opt.replaced.hint', { text: (sel.original ?? '').trim() }) : t('opt.text.hint');
    } else if (mode === 'table') {
      const tb = sel?.type === 'table' ? sel : null;
      this.groups.table.classList.toggle('editing-table', !!tb);
      this.newTable.hidden = !!tb;
      this.tableEdit.hidden = !tb;
      this.rowsValue.textContent = String(store.tableStyle.rows);
      this.colsValue.textContent = String(store.tableStyle.cols);
      sizeOptions(this.tableSize, tb ? tb.size : store.tableStyle.size);
      if (tb) {
        this.alignBtns.left.classList.toggle('active', tb.align === 'left');
        this.alignBtns.center.classList.toggle('active', tb.align === 'center');
        this.headerBtn.classList.toggle('active', tb.header);
      }
    } else if (mode === 'highlight') {
      const h = sel?.type === 'highlight' ? sel : store.highlightStyle;
      this.hlColors.set(h.color);
      this.widthInput.value = String(h.width);
      this.widthValue.textContent = String(h.width);
    }
  }
}
