import { AnnotationMode } from 'pdfjs-dist';
import { emit, livePages, store } from './store';
import { icon } from './ui';
import type { Viewer } from './viewer';

const THUMB_WIDTH = 132; // CSS px

interface Item {
  el: HTMLElement;
  page: HTMLElement;
  label: HTMLElement;
  rendered: boolean;
}

/** 왼쪽 페이지 목록 (썸네일) */
export class Thumbnails {
  private items = new Map<number, Item>();
  private io: IntersectionObserver;
  private queue: number[] = [];
  private running = false;
  private anchor: number | null = null;
  private generation = 0;

  constructor(
    private list: HTMLElement,
    private viewer: Viewer,
    private onDelete: (indices: number[]) => void,
  ) {
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = Number((e.target as HTMLElement).dataset.index);
          const it = this.items.get(idx);
          if (it && !it.rendered && !this.queue.includes(idx)) this.queue.push(idx);
        }
        this.pump();
      },
      { root: list, rootMargin: '300px 0px' },
    );
    list.addEventListener('click', (e) => this.onClick(e));
    list.addEventListener('keydown', (e) => this.onKey(e));
  }

  clear() {
    this.generation += 1;
    this.io.disconnect();
    this.items.clear();
    this.queue = [];
    this.anchor = null;
    this.list.replaceChildren();
  }

  mount() {
    this.clear();
    const frag = document.createDocumentFragment();
    for (const p of store.doc!.pages) {
      const el = document.createElement('div');
      el.className = 'thumb';
      el.dataset.index = String(p.index);
      const page = document.createElement('div');
      page.className = 'thumb-page';
      page.style.aspectRatio = `${p.width} / ${p.height}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'thumb-del';
      del.title = '이 페이지 삭제';
      del.tabIndex = -1;
      del.append(icon('Trash', 14));
      page.append(del);
      const label = document.createElement('div');
      label.className = 'thumb-label';
      el.append(page, label);
      frag.append(el);
      this.items.set(p.index, { el, page, label, rendered: false });
    }
    this.list.append(frag);
    for (const it of this.items.values()) this.io.observe(it.el);
    this.update();
  }

  /** 삭제 상태, 번호, 현재/선택 표시 갱신 */
  update() {
    if (!store.doc) return;
    let n = 0;
    for (const p of store.doc.pages) {
      const it = this.items.get(p.index);
      if (!it) continue;
      const deleted = store.deleted.has(p.index);
      it.el.hidden = deleted;
      if (!deleted) it.label.textContent = String(++n);
      it.el.classList.toggle('current', p.index === store.currentPage);
      it.el.classList.toggle('selected', store.pageSelection.has(p.index));
    }
  }

  revealCurrent() {
    this.items.get(store.currentPage)?.el.scrollIntoView({ block: 'nearest' });
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    try {
      while (this.queue.length && gen === this.generation) {
        const idx = this.queue.shift()!;
        await this.renderThumb(idx, gen).catch((err) => console.error(err));
      }
    } finally {
      this.running = false;
      if (this.queue.length && gen !== this.generation) this.pump();
    }
  }

  private async renderThumb(index: number, gen: number) {
    const it = this.items.get(index);
    if (!it || it.rendered || !store.doc) return;
    const page = await this.viewer.getPage(index);
    if (gen !== this.generation) return;
    const info = store.doc.pages[index];
    const scale = (THUMB_WIDTH / info.width) * Math.min(2, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
    if (gen !== this.generation) return;
    it.page.prepend(canvas);
    it.rendered = true;
  }

  private indexOf(target: EventTarget | null): number | null {
    const el = (target as Element | null)?.closest?.<HTMLElement>('.thumb');
    return el ? Number(el.dataset.index) : null;
  }

  private onClick(e: MouseEvent) {
    const idx = this.indexOf(e.target);
    if (idx === null) return;
    if ((e.target as Element).closest('.thumb-del')) {
      this.onDelete([idx]);
      return;
    }
    const live = livePages().map((p) => p.index);
    if (e.shiftKey && this.anchor !== null && live.includes(this.anchor)) {
      const a = live.indexOf(this.anchor);
      const b = live.indexOf(idx);
      store.pageSelection = new Set(live.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (e.metaKey || e.ctrlKey) {
      if (store.pageSelection.has(idx)) store.pageSelection.delete(idx);
      else store.pageSelection.add(idx);
      this.anchor = idx;
    } else {
      store.pageSelection = new Set([idx]);
      this.anchor = idx;
    }
    emit('pageSelection');
    this.viewer.scrollToPage(idx);
    this.list.focus({ preventScroll: true });
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const targets = store.pageSelection.size ? [...store.pageSelection] : [store.currentPage];
      this.onDelete(targets);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      const live = livePages().map((p) => p.index);
      if (!live.length) return;
      let pos = live.indexOf(this.anchor ?? store.currentPage);
      if (pos < 0) pos = 0;
      if (e.key === 'ArrowDown') pos = Math.min(live.length - 1, pos + 1);
      else if (e.key === 'ArrowUp') pos = Math.max(0, pos - 1);
      else if (e.key === 'Home') pos = 0;
      else pos = live.length - 1;
      const idx = live[pos];
      this.anchor = idx;
      store.pageSelection = new Set([idx]);
      emit('pageSelection');
      this.viewer.scrollToPage(idx);
      this.items.get(idx)?.el.scrollIntoView({ block: 'nearest' });
    }
  }
}
