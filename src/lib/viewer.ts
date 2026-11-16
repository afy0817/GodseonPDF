import { AnnotationMode, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import { clamp } from './geometry';
import { emit, store, type ZoomMode } from './store';
import type { PageInfo } from './types';

/** 100% 배율 = 실제 크기 (1pt = 96/72 CSS px) */
export const CSS_UNITS = 96 / 72;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6;
const AUTO_MAX_ZOOM = 1.25;
const PADDING = 28;
const MAX_CANVAS_PIXELS = 4096 * 4096;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6];
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface PageView {
  info: PageInfo;
  el: HTMLDivElement;
  hl: SVGSVGElement; // 형광펜 레이어 (multiply 합성)
  ann: HTMLDivElement; // 글상자·이미지 레이어
  canvas: HTMLCanvasElement | null;
  renderedKey: string;
  task: RenderTask | null;
  taskKey: string;
  near: boolean; // 화면 근처에 있어 렌더링 대상인지
}

interface Anchor {
  v: PageView;
  fx: number;
  fy: number;
  ax: number;
  ay: number;
}

function releaseCanvas(c: HTMLCanvasElement | null) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

export class Viewer {
  readonly container: HTMLElement;
  readonly pagesEl: HTMLElement;
  views: PageView[] = [];
  private byEl = new WeakMap<Element, PageView>();
  private io: IntersectionObserver;
  private proxies = new Map<number, Promise<PDFPageProxy>>();
  private renderTimer = 0;
  private pumping = false;
  private pumpAgain = false;
  private scrollRaf = 0;
  private resizeRaf = 0;
  private dpr = window.devicePixelRatio || 1;

  constructor(container: HTMLElement, pagesEl: HTMLElement) {
    this.container = container;
    this.pagesEl = pagesEl;
    this.io = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: container,
      rootMargin: '150% 0px 150% 0px',
    });
    container.addEventListener('scroll', () => this.scheduleScrollUpdate(), { passive: true });
    container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    new ResizeObserver(() => this.onResize()).observe(container);
    window.addEventListener('resize', () => {
      const dpr = window.devicePixelRatio || 1;
      if (dpr !== this.dpr) {
        this.dpr = dpr;
        this.requestRender(0);
      }
    });
  }

  get scale() {
    return store.zoom * CSS_UNITS;
  }

  getPage(index: number): Promise<PDFPageProxy> {
    let p = this.proxies.get(index);
    if (!p) {
      p = store.doc!.pdf.getPage(index + 1);
      this.proxies.set(index, p);
    }
    return p;
  }

  viewOf(el: Element): PageView | undefined {
    const page = el.closest('.page');
    return page ? this.byEl.get(page) : undefined;
  }

  /** 화면 좌표 → 페이지 단위 좌표 */
  pagePoint(v: PageView, clientX: number, clientY: number) {
    const r = v.el.getBoundingClientRect();
    const s = this.scale;
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
  }

  /** 화면 좌표 아래에 있는 페이지 */
  pageAt(clientX: number, clientY: number): PageView | undefined {
    for (const v of this.views) {
      if (v.el.hidden || !v.near) continue;
      const r = v.el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return v;
    }
    return undefined;
  }

  /** 페이지 중 지금 화면에 보이는 영역의 중심 (페이지 단위) */
  visibleCenter(v: PageView) {
    const c = this.container.getBoundingClientRect();
    const r = v.el.getBoundingClientRect();
    const left = Math.max(r.left, c.left);
    const right = Math.min(r.right, c.right);
    const top = Math.max(r.top, c.top);
    const bottom = Math.min(r.bottom, c.bottom);
    if (right <= left || bottom <= top) return { x: v.info.width / 2, y: v.info.height / 2 };
    return this.pagePoint(v, (left + right) / 2, (top + bottom) / 2);
  }

  // ---------------------------------------------------------------------------
  // 문서 마운트
  // ---------------------------------------------------------------------------

  mount() {
    this.unmount();
    const doc = store.doc!;
    const frag = document.createDocumentFragment();
    for (const info of doc.pages) {
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.index = String(info.index);
      const hl = document.createElementNS(SVG_NS, 'svg');
      hl.classList.add('hl-layer');
      hl.setAttribute('viewBox', `0 0 ${info.width} ${info.height}`);
      hl.setAttribute('preserveAspectRatio', 'none');
      const ann = document.createElement('div');
      ann.className = 'ann-layer';
      ann.style.width = `${info.width}px`;
      ann.style.height = `${info.height}px`;
      el.append(hl, ann);
      frag.append(el);
      const view: PageView = { info, el, hl, ann, canvas: null, renderedKey: '', task: null, taskKey: '', near: false };
      this.views.push(view);
      this.byEl.set(el, view);
    }
    this.pagesEl.append(frag);
    for (const v of this.views) this.io.observe(v.el);
    this.applyDeleted();
    const fit = this.fitWidthZoom();
    store.zoomMode = 'auto';
    store.zoom = Math.min(fit, AUTO_MAX_ZOOM);
    this.layout();
    this.container.scrollTop = 0;
    this.container.scrollLeft = 0;
    emit('zoom');
    this.requestRender(0);
  }

  unmount() {
    for (const v of this.views) {
      v.task?.cancel();
      this.io.unobserve(v.el);
      releaseCanvas(v.canvas);
    }
    this.views = [];
    this.proxies.clear();
    this.pagesEl.replaceChildren();
  }

  /** 삭제된 페이지 숨김 처리 */
  applyDeleted() {
    for (const v of this.views) v.el.hidden = store.deleted.has(v.info.index);
    if (store.zoomMode !== 'custom') this.refit();
    this.requestRender(0);
    this.scheduleScrollUpdate();
  }

  layout() {
    const s = this.scale;
    for (const v of this.views) {
      v.el.style.width = `${v.info.width * s}px`;
      v.el.style.height = `${v.info.height * s}px`;
      v.ann.style.transform = `scale(${s})`;
    }
    this.pagesEl.style.setProperty('--inv-scale', String(1 / s));
  }

  // ---------------------------------------------------------------------------
  // 배율
  // ---------------------------------------------------------------------------

  fitWidthZoom(): number {
    const live = this.views.filter((v) => !v.el.hidden);
    const maxW = Math.max(1, ...live.map((v) => v.info.width));
    const avail = Math.max(100, this.container.clientWidth - PADDING * 2);
    return clamp(avail / (maxW * CSS_UNITS), MIN_ZOOM, MAX_ZOOM);
  }

  setZoom(zoom: number, mode: ZoomMode = 'custom', anchor?: { clientX: number; clientY: number }) {
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(z - store.zoom) < 1e-4) {
      store.zoomMode = mode;
      emit('zoom');
      return;
    }
    const a = this.captureAnchor(anchor);
    store.zoom = z;
    store.zoomMode = mode;
    this.layout();
    if (a) this.restoreAnchor(a);
    const key = this.renderKey();
    for (const v of this.views) if (v.task && v.taskKey !== key) v.task.cancel();
    this.requestRender(140);
    emit('zoom');
  }

  zoomToMode(mode: 'auto' | 'width') {
    const fit = this.fitWidthZoom();
    this.setZoom(mode === 'auto' ? Math.min(fit, AUTO_MAX_ZOOM) : fit, mode);
  }

  zoomStep(dir: 1 | -1) {
    const z = store.zoom;
    const next =
      dir > 0
        ? (ZOOM_STEPS.find((s) => s > z + 0.001) ?? MAX_ZOOM)
        : ([...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? MIN_ZOOM);
    this.setZoom(next, 'custom');
  }

  private refit() {
    if (!this.views.length) return;
    if (store.zoomMode === 'auto') this.zoomToMode('auto');
    else if (store.zoomMode === 'width') this.zoomToMode('width');
  }

  private onResize() {
    if (this.resizeRaf) return;
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = 0;
      if (store.doc && store.zoomMode !== 'custom') this.refit();
    });
  }

  private onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || !store.doc) return;
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const factor = clamp(Math.exp(-delta * 0.0025), 0.8, 1.25);
    this.setZoom(store.zoom * factor, 'custom', e);
  }

  private captureAnchor(pt?: { clientX: number; clientY: number }): Anchor | null {
    const c = this.container.getBoundingClientRect();
    const ax = pt ? pt.clientX - c.left : c.width / 2;
    const ay = pt ? pt.clientY - c.top : c.height / 2;
    const clientX = c.left + ax;
    const clientY = c.top + ay;
    let best: PageView | null = null;
    let bestDist = Infinity;
    for (const v of this.views) {
      if (v.el.hidden) continue;
      const r = v.el.getBoundingClientRect();
      const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
      if (d < bestDist) {
        bestDist = d;
        best = v;
        if (d === 0) break;
      }
    }
    if (!best) return null;
    const r = best.el.getBoundingClientRect();
    return { v: best, fx: (clientX - r.left) / r.width, fy: (clientY - r.top) / r.height, ax, ay };
  }

  private restoreAnchor(a: Anchor) {
    const c = this.container.getBoundingClientRect();
    const r = a.v.el.getBoundingClientRect();
    this.container.scrollLeft += r.left + a.fx * r.width - c.left - a.ax;
    this.container.scrollTop += r.top + a.fy * r.height - c.top - a.ay;
  }

  // ---------------------------------------------------------------------------
  // 스크롤 / 현재 페이지
  // ---------------------------------------------------------------------------

  scrollToPage(index: number) {
    const v = this.views[index];
    if (!v || v.el.hidden) return;
    const c = this.container.getBoundingClientRect();
    const r = v.el.getBoundingClientRect();
    this.container.scrollTop += r.top - c.top - 16;
  }

  private scheduleScrollUpdate() {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.updateCurrentPage();
    });
  }

  private updateCurrentPage() {
    const c = this.container.getBoundingClientRect();
    let best = -1;
    let bestVisible = 0;
    for (const v of this.views) {
      if (!v.near || v.el.hidden) continue;
      const r = v.el.getBoundingClientRect();
      const visible = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top);
      if (visible > bestVisible + 0.5) {
        bestVisible = visible;
        best = v.info.index;
      }
    }
    if (best < 0) {
      // 화면 근처 페이지 정보가 아직 없으면 삭제되지 않은 첫 페이지
      const first = this.views.find((v) => !v.el.hidden);
      if (!first || !store.deleted.has(store.currentPage)) return;
      best = first.info.index;
    }
    if (best !== store.currentPage) {
      store.currentPage = best;
      emit('currentPage');
    }
  }

  // ---------------------------------------------------------------------------
  // 렌더링
  // ---------------------------------------------------------------------------

  private onIntersect(entries: IntersectionObserverEntry[]) {
    for (const e of entries) {
      const v = this.byEl.get(e.target);
      if (!v) continue;
      v.near = e.isIntersecting;
      if (!v.near) this.release(v);
    }
    this.requestRender(0);
    this.scheduleScrollUpdate();
  }

  private release(v: PageView) {
    v.task?.cancel();
    v.task = null;
    releaseCanvas(v.canvas);
    v.canvas?.remove();
    v.canvas = null;
    v.renderedKey = '';
  }

  requestRender(delay: number) {
    clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.pump(), delay);
  }

  private renderKey() {
    return `${this.scale.toFixed(5)}@${window.devicePixelRatio || 1}`;
  }

  private async pump() {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      for (;;) {
        const v = this.nextToRender();
        if (!v) break;
        await this.renderView(v);
      }
    } finally {
      this.pumping = false;
      if (this.pumpAgain) {
        this.pumpAgain = false;
        this.requestRender(0);
      }
    }
  }

  private nextToRender(): PageView | null {
    const key = this.renderKey();
    const c = this.container.getBoundingClientRect();
    const mid = c.top + c.height / 2;
    let best: PageView | null = null;
    let bestDist = Infinity;
    for (const v of this.views) {
      if (!v.near || v.el.hidden || v.renderedKey === key) continue;
      const r = v.el.getBoundingClientRect();
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best;
  }

  private async renderView(v: PageView) {
    const key = this.renderKey();
    const doc = store.doc;
    if (!doc) return;
    let page: PDFPageProxy;
    try {
      page = await this.getPage(v.info.index);
    } catch (err) {
      console.error(err);
      v.renderedKey = key;
      return;
    }
    if (store.doc !== doc) return;
    const viewport = page.getViewport({ scale: this.scale });
    let out = window.devicePixelRatio || 1;
    if (viewport.width * viewport.height * out * out > MAX_CANVAS_PIXELS) {
      out = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    canvas.width = Math.max(1, Math.floor(viewport.width * out));
    canvas.height = Math.max(1, Math.floor(viewport.height * out));
    const task = page.render({
      canvas,
      viewport,
      transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined,
      annotationMode: AnnotationMode.ENABLE,
    });
    v.task = task;
    v.taskKey = key;
    try {
      await task.promise;
    } catch (err) {
      releaseCanvas(canvas);
      if ((err as Error)?.name !== 'RenderingCancelledException') {
        console.error(err);
        v.renderedKey = key; // 같은 페이지를 계속 다시 시도하지 않도록
      }
      return;
    } finally {
      if (v.task === task) v.task = null;
    }
    if (!v.near || v.el.hidden || store.doc !== doc) {
      releaseCanvas(canvas);
      return;
    }
    const stale = this.renderKey() !== key;
    if (stale && v.canvas) {
      releaseCanvas(canvas);
      return;
    }
    releaseCanvas(v.canvas);
    v.canvas?.remove();
    v.el.insertBefore(canvas, v.hl);
    v.canvas = canvas;
    v.renderedKey = key;
  }
}
