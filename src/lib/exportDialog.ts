import { t } from './i18n';
import { imageSize, type ImageFormat } from './imageExport';
import { formatPages, parsePageRange } from './pageRange';
import { esc, icon } from './ui';

// ---------------------------------------------------------------------------
// 이미지로 내보내기 대화상자: 페이지(선택·현재·전체·직접 지정), 형식, 해상도, 여러 장 저장 방법
// ---------------------------------------------------------------------------

export interface ImageExportChoice {
  /** 내보낼 페이지 (1부터, 지금 문서의 페이지 순서) */
  pages: number[];
  format: ImageFormat;
  dpi: number;
  /** 여러 장일 때: ZIP 하나로 묶을지, 폴더에 낱장으로 둘지 */
  output: 'zip' | 'folder';
}

interface Prefs {
  format: ImageFormat;
  dpi: number;
  output: 'zip' | 'folder';
}

const PREFS_KEY = 'godseon.imageExport';
const DPIS = [72, 150, 300] as const;

function loadPrefs(): Prefs {
  const prefs: Prefs = { format: 'png', dpi: 150, output: 'zip' };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    if (p.format === 'jpg') prefs.format = 'jpg';
    if ((DPIS as readonly number[]).includes(p.dpi)) prefs.dpi = p.dpi;
    if (p.output === 'folder') prefs.output = 'folder';
  } catch {
    /* 기본값 */
  }
  return prefs;
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 기억하지 못해도 괜찮다 */
  }
}

export function chooseImageExport(info: {
  /** 페이지 목록에서 고른 페이지 (1부터) */
  selected: number[];
  current: number;
  total: number;
  /** 페이지 크기 (pt, 회전 반영) */
  sizeOf: (page: number) => { width: number; height: number };
  /** 폴더에 낱장으로 저장할 수 있는지 (데스크톱 앱) */
  canFolder: boolean;
}): Promise<ImageExportChoice | null> {
  const prefs = loadPrefs();
  const hasSelection = info.selected.length > 0;
  const seg = (name: string, items: Array<{ value: string; label: string; title: string }>, checked: string) =>
    `<div class="seg-group seg-radio" role="radiogroup">${items
      .map(
        (it) =>
          `<label title="${esc(it.title)}"><input type="radio" name="${name}" value="${it.value}"${it.value === checked ? ' checked' : ''} /><span>${esc(it.label)}</span></label>`,
      )
      .join('')}</div>`;
  const dpiTitle: Record<number, string> = { 72: t('imgx.dpi72'), 150: t('imgx.dpi150'), 300: t('imgx.dpi300') };

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const form = document.createElement('form');
    form.className = 'modal modal-wide export-modal';
    form.innerHTML = `
      <div class="modal-icon"></div>
      <h2>${esc(t('imgx.title'))}</h2>
      <p class="modal-desc">${esc(t('imgx.desc'))}</p>
      <div class="modal-field">
        <div class="modal-label">${esc(t('imgx.pages'))}</div>
        <div class="modal-options">
          ${
            hasSelection
              ? `<label><input type="radio" name="scope" value="selected" /> ${esc(t('imgx.selected'))} <span class="muted">${esc(
                  t('imgx.selectedDetail', { n: info.selected.length, pages: formatPages(info.selected) }),
                )}</span></label>`
              : `<label><input type="radio" name="scope" value="current" /> ${esc(t('imgx.current'))} <span class="muted">${esc(
                  t('imgx.currentDetail', { page: info.current }),
                )}</span></label>`
          }
          <label><input type="radio" name="scope" value="all" /> ${esc(t('imgx.all'))} <span class="muted">${esc(t('imgx.allDetail', { n: info.total }))}</span></label>
          <label class="range-row"><input type="radio" name="scope" value="range" /> ${esc(t('imgx.range'))}
            <input type="text" name="range" class="range-input" autocomplete="off" spellcheck="false" placeholder="${esc(t('imgx.rangePlaceholder'))}" /></label>
        </div>
      </div>
      <div class="modal-row">
        <span class="modal-label">${esc(t('imgx.format'))}</span>
        ${seg(
          'format',
          [
            { value: 'png', label: 'PNG', title: t('imgx.png.title') },
            { value: 'jpg', label: 'JPG', title: t('imgx.jpg.title') },
          ],
          prefs.format,
        )}
      </div>
      <div class="modal-row">
        <span class="modal-label">${esc(t('imgx.dpi'))}</span>
        ${seg(
          'dpi',
          DPIS.map((d) => ({ value: String(d), label: String(d), title: dpiTitle[d] })),
          String(prefs.dpi),
        )}
        <span class="muted">dpi</span>
      </div>
      <div class="modal-field" data-output>
        <div class="modal-label">${esc(t('imgx.output'))}</div>
        <div class="modal-options">
          <label><input type="radio" name="output" value="zip"${prefs.output === 'zip' ? ' checked' : ''} /> ${esc(t('imgx.zip'))}</label>
          <label><input type="radio" name="output" value="folder"${prefs.output === 'folder' ? ' checked' : ''} /> ${esc(t('imgx.folder'))}</label>
        </div>
      </div>
      <p class="modal-hint" data-summary></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="cancel">${esc(t('common.cancel'))}</button>
        <button type="submit" class="btn btn-primary">${esc(t('imgx.ok'))}</button>
      </div>`;
    form.querySelector('.modal-icon')!.append(icon('ImageDown', 22));

    const radio = (name: string, value: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
    radio('scope', hasSelection ? 'selected' : 'all').checked = true;
    const rangeInput = form.querySelector<HTMLInputElement>('.range-input')!;
    const summary = form.querySelector<HTMLElement>('[data-summary]')!;
    const outputBox = form.querySelector<HTMLElement>('[data-output]')!;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    if (!info.canFolder) radio('output', 'zip').checked = true;

    const read = () => {
      const data = new FormData(form);
      const scope = String(data.get('scope'));
      let pages: number[] | null;
      if (scope === 'selected') pages = info.selected;
      else if (scope === 'current') pages = [info.current];
      else if (scope === 'all') pages = Array.from({ length: info.total }, (_, i) => i + 1);
      else pages = parsePageRange(rangeInput.value, info.total);
      return {
        pages,
        format: (data.get('format') === 'jpg' ? 'jpg' : 'png') as ImageFormat,
        dpi: Number(data.get('dpi')) || 150,
        output: (info.canFolder && data.get('output') === 'folder' ? 'folder' : 'zip') as 'zip' | 'folder',
      };
    };

    const update = () => {
      const c = read();
      const ok = !!c.pages?.length;
      submit.disabled = !ok;
      summary.classList.toggle('error', !ok);
      // 여러 장이고 폴더 저장이 가능할 때만 저장 방법을 고른다 (한 장이면 이미지 파일 하나)
      outputBox.hidden = !ok || c.pages!.length < 2 || !info.canFolder;
      if (!ok) {
        summary.textContent = rangeInput.value.trim() ? t('imgx.rangeInvalid', { total: info.total }) : t('imgx.rangeEmpty');
        return;
      }
      const sizes = c.pages!.map((p) => info.sizeOf(p));
      const first = imageSize(sizes[0].width, sizes[0].height, c.dpi);
      const same = sizes.every((s) => Math.abs(s.width - sizes[0].width) < 0.5 && Math.abs(s.height - sizes[0].height) < 0.5);
      summary.textContent = t(same ? 'imgx.summary' : 'imgx.summaryFirst', { n: c.pages!.length, w: first.width, h: first.height });
    };

    const done = (v: ImageExportChoice | null) => {
      backdrop.remove();
      resolve(v);
    };
    form.addEventListener('change', update);
    rangeInput.addEventListener('input', () => {
      radio('scope', 'range').checked = true;
      update();
    });
    rangeInput.addEventListener('focus', () => {
      radio('scope', 'range').checked = true;
      update();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = read();
      if (!c.pages?.length) return;
      savePrefs({ format: c.format, dpi: c.dpi, output: info.canFolder ? c.output : prefs.output });
      done({ pages: c.pages, format: c.format, dpi: c.dpi, output: c.output });
    });
    form.querySelector('[data-act="cancel"]')!.addEventListener('click', () => done(null));
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    });
    update();
    backdrop.append(form);
    document.body.append(backdrop);
    submit.focus();
  });
}
