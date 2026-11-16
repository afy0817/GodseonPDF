import type { Annotation } from './types';

export interface Snapshot {
  annotations: Annotation[];
  deleted: number[];
}

const LIMIT = 300;
const COALESCE_MS = 1000;

const clone = (s: Snapshot): Snapshot => structuredClone(s);

/** 스냅샷 기반 실행 취소/다시 실행. 이미지 바이트는 별도 보관하므로 스냅샷은 가볍다. */
export class History {
  private stack: Snapshot[] = [];
  private index = -1;
  private savedIndex = -1;
  private lastKey: string | null = null;
  private lastTime = 0;

  reset(s: Snapshot) {
    this.stack = [clone(s)];
    this.index = 0;
    this.savedIndex = 0;
    this.lastKey = null;
  }

  /** coalesceKey 가 같고 짧은 시간 안에 연속으로 들어온 변경(예: 방향키 이동)은 하나로 합친다. */
  push(s: Snapshot, coalesceKey?: string) {
    const now = performance.now();
    const canMerge =
      coalesceKey !== undefined &&
      coalesceKey === this.lastKey &&
      now - this.lastTime < COALESCE_MS &&
      this.index === this.stack.length - 1 &&
      this.index > 0 &&
      this.index !== this.savedIndex;
    this.lastKey = coalesceKey ?? null;
    this.lastTime = now;
    if (canMerge) {
      this.stack[this.index] = clone(s);
      return;
    }
    this.stack.length = this.index + 1;
    this.stack.push(clone(s));
    this.index += 1;
    if (this.stack.length > LIMIT) {
      this.stack.shift();
      this.index -= 1;
      this.savedIndex -= 1;
    }
  }

  undo(): Snapshot | null {
    if (this.index <= 0) return null;
    this.index -= 1;
    this.lastKey = null;
    return clone(this.stack[this.index]);
  }

  redo(): Snapshot | null {
    if (this.index >= this.stack.length - 1) return null;
    this.index += 1;
    this.lastKey = null;
    return clone(this.stack[this.index]);
  }

  markSaved() {
    this.savedIndex = this.index;
    this.lastKey = null;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.stack.length - 1;
  }

  get dirty() {
    return this.index !== this.savedIndex;
  }
}
