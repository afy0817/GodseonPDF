import { t } from './i18n';
import * as platform from './platform';
import { describeError, icon, toast } from './ui';

// ---------------------------------------------------------------------------
// 서명 서랍: 만들어 둔 서명(투명 PNG)을 모아 두고, 끌어서 페이지에 놓거나 눌러서 넣는다.
// ---------------------------------------------------------------------------

/** 서랍에서 끌어 온 서명을 알아보는 끌어다 놓기 자료 형식 */
export const SIGNATURE_DRAG_TYPE = 'application/x-godseon-signature';

export interface Signature {
  id: string;
  name: string;
  bytes: Uint8Array;
  width: number; // 픽셀
  height: number;
  url: string; // 서랍 미리보기용 object URL
}

async function decode(id: string, name: string, bytes: Uint8Array): Promise<Signature> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const sig = { id, name, bytes, width: bitmap.width, height: bitmap.height, url: URL.createObjectURL(blob) };
  bitmap.close();
  return sig;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class SignatureDrawer {
  items: Signature[] = [];
  private loaded: Promise<void> | null = null;
  private readonly list: HTMLElement;
  private readonly onInsert: (sig: Signature) => void;

  constructor(list: HTMLElement, onInsert: (sig: Signature) => void) {
    this.list = list;
    this.onInsert = onInsert;
    list.addEventListener('click', (e) => {
      const card = (e.target as Element).closest<HTMLElement>('.sig-card');
      const sig = card && this.get(card.dataset.id);
      if (!sig) return;
      if ((e.target as Element).closest('.sig-del')) void this.remove(sig.id);
      else this.onInsert(sig);
    });
    list.addEventListener('keydown', (e) => {
      const card = (e.target as Element).closest<HTMLElement>('.sig-card');
      const sig = card && e.target === card ? this.get(card.dataset.id) : undefined;
      if (!sig) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onInsert(sig);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        void this.remove(sig.id);
      }
      e.stopPropagation();
    });
    list.addEventListener('dragstart', (e) => {
      const card = (e.target as Element).closest<HTMLElement>('.sig-card');
      const sig = card && this.get(card.dataset.id);
      if (!sig || !e.dataTransfer) return;
      e.dataTransfer.setData(SIGNATURE_DRAG_TYPE, sig.id);
      e.dataTransfer.effectAllowed = 'copy';
      const img = card.querySelector('img');
      if (img) e.dataTransfer.setDragImage(img, img.clientWidth / 2, img.clientHeight / 2);
      card.classList.add('dragging');
    });
    list.addEventListener('dragend', (e) => (e.target as Element).closest('.sig-card')?.classList.remove('dragging'));
  }

  get(id: string | undefined): Signature | undefined {
    return this.items.find((s) => s.id === id);
  }

  /** 저장해 둔 서명 불러오기 (처음 한 번) */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const stored = await platform.listSignatures();
        const decoded = await Promise.all(stored.map((s) => decode(s.id, s.name, s.data).catch(() => null)));
        this.items = decoded.filter((s): s is Signature => !!s);
      } catch (err) {
        toast(t('toast.sigLoadFailed', { msg: describeError(err) }), { type: 'error' });
      }
      this.render();
    })();
    return this.loaded;
  }

  /** 새 서명을 서랍 맨 앞에 저장 */
  async add(png: Uint8Array): Promise<Signature> {
    await this.load();
    const name = t('sig.defaultName', { date: stamp() });
    const id = await platform.saveSignature(name, png);
    const sig = await decode(id, name, png);
    this.items.unshift(sig);
    this.render();
    return sig;
  }

  /** 서랍에서 지우기 (알림의 '실행 취소'로 되살릴 수 있다) */
  async remove(id: string) {
    const index = this.items.findIndex((s) => s.id === id);
    if (index < 0) return;
    const [sig] = this.items.splice(index, 1);
    this.render();
    try {
      await platform.removeSignature(id);
    } catch (err) {
      this.items.splice(index, 0, sig);
      this.render();
      toast(describeError(err), { type: 'error' });
      return;
    }
    let restored = false;
    toast(t('toast.sigRemoved'), {
      duration: 6000,
      action: {
        label: t('action.undo'),
        run: async () => {
          restored = true;
          try {
            sig.id = await platform.saveSignature(sig.name, sig.bytes);
            this.items.splice(Math.min(index, this.items.length), 0, sig);
            this.render();
          } catch (err) {
            toast(t('toast.sigSaveFailed', { msg: describeError(err) }), { type: 'error' });
          }
        },
      },
    });
    setTimeout(() => {
      if (!restored) URL.revokeObjectURL(sig.url);
    }, 10_000);
  }

  render() {
    this.list.replaceChildren();
    if (!this.items.length) {
      const empty = document.createElement('div');
      empty.className = 'sig-empty';
      empty.textContent = t('sig.empty');
      this.list.append(empty);
      return;
    }
    for (const sig of this.items) {
      const card = document.createElement('div');
      card.className = 'sig-card';
      card.dataset.id = sig.id;
      card.draggable = true;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.title = t('sig.card.title');
      const img = document.createElement('img');
      img.src = sig.url;
      img.alt = sig.name;
      img.draggable = false;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sig-del';
      del.title = t('sig.remove');
      del.setAttribute('aria-label', t('sig.remove'));
      del.append(icon('Trash', 14));
      card.append(img, del);
      this.list.append(card);
    }
  }
}
