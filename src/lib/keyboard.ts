import * as E from './editor';
import { store } from './store';

export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/**
 * 키보드 단축키. Electron 에서는 저장/열기/실행 취소/배율 단축키를 메뉴(accelerator)가 처리하므로
 * 여기서는 브라우저로 실행할 때만 처리한다.
 */
export function setupKeyboard(run: (command: string) => void, handledByMenu: boolean) {
  window.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중
    const editable = isEditableTarget(e.target);
    const mod = e.metaKey || e.ctrlKey;

    if (!handledByMenu && mod && !e.altKey) {
      const k = e.key.toLowerCase();
      const map: Record<string, string> = { s: e.shiftKey ? 'saveAs' : 'save', o: 'open', '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', '0': 'zoomReset' };
      if (!editable) Object.assign(map, { z: e.shiftKey ? 'redo' : 'undo', y: 'redo' });
      if (map[k]) {
        e.preventDefault();
        run(map[k]);
        return;
      }
    }

    if (editable || mod || e.altKey || !store.doc) return;
    if ((e.target as HTMLElement | null)?.closest?.('#thumbs')) return; // 페이지 목록이 따로 처리

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (store.selectedId) {
        e.preventDefault();
        run('deleteSelection');
      }
      return;
    }
    if (e.key === 'Escape') {
      run('escape');
      return;
    }
    if (e.key.startsWith('Arrow') && store.selectedId) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      E.nudgeSelected(dx, dy);
      return;
    }
    if (e.shiftKey) return;
    // 한글 자판에서도 동작하도록 물리 키(code)로 판단
    const byCode: Record<string, string> = {
      KeyV: 'tool:select',
      KeyT: 'tool:text',
      KeyH: 'tool:highlight',
      KeyE: 'tool:eraser',
      KeyG: 'tool:table',
      KeyI: 'insertImage',
    };
    const command = byCode[e.code];
    if (command) {
      e.preventDefault();
      run(command);
    }
  });
}
