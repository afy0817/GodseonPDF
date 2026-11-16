'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { fileURLToPath } = require('node:url');

const APP_NAME = 'GodseonPDF';
const IS_MAC = process.platform === 'darwin';
const DEV_URL = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIR = path.join(__dirname, '..', 'dist', 'renderer');
const APP_URL = 'app://bundle/index.html';

app.setName(APP_NAME);

// 렌더러는 file:// 대신 전용 app:// 프로토콜로 불러온다 (Worker, fetch, ES 모듈이 안정적으로 동작).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/** @typedef {{ dirty: boolean, title: string, hasDocument: boolean, ready: boolean, allowClose: boolean, closing: boolean, outbox: Array<[string, any]> }} WinState */
/** @type {Map<BrowserWindow, WinState>} */
const windows = new Map();
const pendingPaths = [];
let quitting = false;

// ---------------------------------------------------------------------------
// 파일 경로 처리
// ---------------------------------------------------------------------------

function isPdfPath(p) {
  return typeof p === 'string' && path.isAbsolute(p) && /\.pdf$/i.test(p);
}

function extractPdfPaths(argv, cwd) {
  const result = [];
  for (const raw of argv) {
    if (typeof raw !== 'string' || raw.startsWith('-')) continue;
    let p = raw;
    try {
      if (p.startsWith('file://')) p = fileURLToPath(p);
      p = path.resolve(cwd || process.cwd(), p);
    } catch {
      continue;
    }
    if (/\.pdf$/i.test(p) && fs.existsSync(p) && fs.statSync(p).isFile()) result.push(p);
  }
  return result;
}

async function readPdf(filePath) {
  const data = await fsp.readFile(filePath);
  const head = data.subarray(0, 1024).toString('latin1');
  if (!head.includes('%PDF')) throw new Error('PDF 파일이 아닙니다.');
  return { path: filePath, name: path.basename(filePath), data };
}

async function writeFileSafely(target, data) {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}-${Date.now()}.tmp`);
  try {
    let mode;
    try {
      mode = (await fsp.stat(target)).mode;
    } catch {
      /* 새 파일 */
    }
    await fsp.writeFile(tmp, buf, mode ? { mode } : undefined);
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    // 임시 파일을 만들 수 없는 폴더(권한, 클라우드 동기화 폴더 등)에서는 직접 덮어쓴다.
    try {
      await fsp.writeFile(target, buf);
    } catch (err2) {
      if (err2 && (err2.code === 'EBUSY' || err2.code === 'EPERM' || err2.code === 'EACCES')) {
        throw new Error('파일에 쓸 수 없습니다. 다른 프로그램에서 열려 있거나 쓰기 권한이 없는지 확인하세요.');
      }
      throw err2 || err;
    }
  }
}

// ---------------------------------------------------------------------------
// 창 관리
// ---------------------------------------------------------------------------

function stateOf(win) {
  return win ? windows.get(win) : undefined;
}

function send(win, channel, payload) {
  const st = stateOf(win);
  if (!st) return;
  if (st.ready) win.webContents.send(channel, payload);
  else st.outbox.push([channel, payload]);
}

function windowIcon() {
  if (process.platform !== 'linux') return undefined;
  const p = path.join(RENDERER_DIR, 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 760,
    minHeight: 480,
    title: APP_NAME,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1f23' : '#eef0f3',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    autoHideMenuBar: !IS_MAC,
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  windows.set(win, { dirty: false, title: APP_NAME, hasDocument: false, ready: false, allowClose: false, closing: false, outbox: [] });

  win.once('ready-to-show', () => win.show());

  win.on('close', (event) => {
    const st = stateOf(win);
    if (!st || st.allowClose || !st.dirty) return;
    event.preventDefault();
    if (st.closing) return;
    st.closing = true;
    dialog
      .showMessageBox(win, {
        type: 'warning',
        buttons: ['저장', '저장하지 않음', '취소'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        message: `"${st.title}" 문서의 변경 내용을 저장할까요?`,
        detail: '저장하지 않으면 변경 내용이 사라집니다.',
      })
      .then(({ response }) => {
        st.closing = false;
        if (response === 0) {
          win.webContents.send('app:save-and-close');
        } else if (response === 1) {
          st.allowClose = true;
          win.close();
        } else {
          quitting = false;
        }
      });
  });

  win.on('closed', () => {
    windows.delete(win);
    if (quitting) setImmediate(() => app.quit());
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL(APP_URL);
  return win;
}

/** 경로의 PDF를 연다: 문서가 없는 창이 있으면 그 창에, 없으면 새 창에. */
async function openPath(filePath) {
  let file;
  try {
    file = await readPdf(filePath);
  } catch (err) {
    dialog.showErrorBox('파일을 열 수 없습니다', `${filePath}\n\n${err.message}`);
    return;
  }
  let target = [...windows.entries()].find(([, st]) => !st.hasDocument)?.[0];
  if (!target) target = createWindow();
  stateOf(target).hasDocument = true;
  send(target, 'pdf:opened', file);
  if (target.isMinimized()) target.restore();
  target.focus();
  app.addRecentDocument(filePath);
}

function sendCommand(command, win) {
  const target = win || BrowserWindow.getFocusedWindow() || [...windows.keys()][0];
  if (!target) {
    if (command === 'open') send(createWindow(), 'menu:command', command);
    return;
  }
  send(target, 'menu:command', command);
}

// ---------------------------------------------------------------------------
// 메뉴
// ---------------------------------------------------------------------------

function buildMenu() {
  const cmd = (command) => (_item, win) => sendCommand(command, win);
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];
  if (IS_MAC) {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `${APP_NAME} 정보` },
        { type: 'separator' },
        { role: 'services', label: '서비스' },
        { type: 'separator' },
        { role: 'hide', label: `${APP_NAME} 가리기` },
        { role: 'hideOthers', label: '기타 가리기' },
        { role: 'unhide', label: '모두 보기' },
        { type: 'separator' },
        { role: 'quit', label: `${APP_NAME} 종료` },
      ],
    });
  }
  template.push(
    {
      label: '파일',
      submenu: [
        { label: '새 창', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: '열기…', accelerator: 'CmdOrCtrl+O', click: cmd('open') },
        { type: 'separator' },
        { label: '저장', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
        { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('saveAs') },
        { type: 'separator' },
        { role: 'close', label: '창 닫기' },
        ...(IS_MAC ? [] : [{ type: 'separator' }, { role: 'quit', label: '종료' }]),
      ],
    },
    {
      label: '편집',
      submenu: [
        { label: '실행 취소', accelerator: 'CmdOrCtrl+Z', click: cmd('undo') },
        { label: '다시 실행', accelerator: IS_MAC ? 'Shift+Cmd+Z' : 'Ctrl+Y', click: cmd('redo') },
        ...(IS_MAC ? [] : [{ label: '다시 실행', accelerator: 'Ctrl+Shift+Z', visible: false, click: cmd('redo') }]),
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '모두 선택' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { label: '확대', accelerator: 'CmdOrCtrl+=', click: cmd('zoomIn') },
        { label: '확대', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: cmd('zoomIn') },
        { label: '확대', accelerator: 'CmdOrCtrl+numadd', visible: false, acceleratorWorksWhenHidden: true, click: cmd('zoomIn') },
        { label: '축소', accelerator: 'CmdOrCtrl+-', click: cmd('zoomOut') },
        { label: '축소', accelerator: 'CmdOrCtrl+numsub', visible: false, acceleratorWorksWhenHidden: true, click: cmd('zoomOut') },
        { label: '실제 크기', accelerator: 'CmdOrCtrl+0', click: cmd('zoomReset') },
        { label: '폭에 맞추기', accelerator: 'CmdOrCtrl+9', click: cmd('zoomFit') },
        { type: 'separator' },
        { label: '페이지 목록 보기/숨기기', click: cmd('toggleSidebar') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools', label: '개발자 도구' }]),
      ],
    },
    {
      label: '도구',
      submenu: [
        { label: '선택', click: cmd('tool:select') },
        { label: '텍스트', click: cmd('tool:text') },
        { label: '형광펜', click: cmd('tool:highlight') },
        { label: '지우개', click: cmd('tool:eraser') },
        { label: '표', click: cmd('tool:table') },
        { type: 'separator' },
        { label: '이미지 삽입…', click: cmd('insertImage') },
        { label: '선택한 페이지 삭제', click: cmd('deletePages') },
      ],
    },
  );
  if (IS_MAC) template.push({ role: 'windowMenu', label: '윈도우' });
  template.push({
    role: 'help',
    label: '도움말',
    submenu: [{ label: `${APP_NAME} 정보`, click: () => app.showAboutPanel() }],
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  const winOf = (event) => BrowserWindow.fromWebContents(event.sender);

  ipcMain.handle('pdf:open-dialog', async (event) => {
    const win = winOf(event);
    const result = await dialog.showOpenDialog(win, {
      title: 'PDF 열기',
      properties: ['openFile'],
      filters: [{ name: 'PDF 문서', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = await readPdf(result.filePaths[0]);
    app.addRecentDocument(file.path);
    return file;
  });

  ipcMain.handle('pdf:open-path', async (_event, filePath) => {
    if (!isPdfPath(filePath)) throw new Error('PDF 파일만 열 수 있습니다.');
    const file = await readPdf(filePath);
    app.addRecentDocument(file.path);
    return file;
  });

  ipcMain.handle('pdf:save', async (_event, { path: filePath, data }) => {
    if (!isPdfPath(filePath)) throw new Error('잘못된 저장 경로입니다.');
    if (!(data instanceof Uint8Array)) throw new Error('잘못된 데이터입니다.');
    await writeFileSafely(filePath, data);
    return { path: filePath, name: path.basename(filePath) };
  });

  ipcMain.handle('pdf:save-as', async (event, { data, suggestedName, defaultDir }) => {
    if (!(data instanceof Uint8Array)) throw new Error('잘못된 데이터입니다.');
    const win = winOf(event);
    const name = typeof suggestedName === 'string' && suggestedName ? suggestedName : '문서.pdf';
    const dir = typeof defaultDir === 'string' && path.isAbsolute(defaultDir) ? defaultDir : app.getPath('documents');
    const result = await dialog.showSaveDialog(win, {
      title: '다른 이름으로 저장',
      defaultPath: path.join(dir, name),
      filters: [{ name: 'PDF 문서', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;
    let filePath = result.filePath;
    if (!/\.pdf$/i.test(filePath)) filePath += '.pdf';
    await writeFileSafely(filePath, data);
    app.addRecentDocument(filePath);
    return { path: filePath, name: path.basename(filePath) };
  });

  ipcMain.handle('dialog:confirm-unsaved', async (event, docName) => {
    const win = winOf(event);
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['저장', '저장하지 않음', '취소'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: `"${docName}" 문서의 변경 내용을 저장할까요?`,
      detail: '저장하지 않으면 변경 내용이 사라집니다.',
    });
    return ['save', 'discard', 'cancel'][response];
  });

  ipcMain.on('doc:state', (event, s) => {
    const win = winOf(event);
    const st = stateOf(win);
    if (!st || !s) return;
    st.dirty = !!s.dirty;
    st.hasDocument = !!s.hasDocument;
    st.title = typeof s.title === 'string' ? s.title : APP_NAME;
    win.setTitle(s.hasDocument ? `${st.dirty && !IS_MAC ? '● ' : ''}${st.title} — ${APP_NAME}` : APP_NAME);
    if (IS_MAC) {
      win.setDocumentEdited(st.dirty);
      win.setRepresentedFilename(typeof s.path === 'string' ? s.path : '');
    }
  });

  ipcMain.on('renderer:ready', (event) => {
    const st = stateOf(winOf(event));
    if (!st) return;
    st.ready = true;
    const queued = st.outbox.splice(0);
    for (const [channel, payload] of queued) event.sender.send(channel, payload);
  });

  ipcMain.on('window:close-confirmed', (event) => {
    const win = winOf(event);
    const st = stateOf(win);
    if (!st) return;
    st.allowClose = true;
    win.close();
  });
}

// ---------------------------------------------------------------------------
// 앱 생명주기
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // macOS: Finder에서 "다음으로 열기" / Dock 에 드롭
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (app.isReady()) openPath(filePath);
    else pendingPaths.push(filePath);
  });

  // Windows / Linux: 이미 실행 중일 때 파일을 더블클릭하면 두 번째 인스턴스의 인자로 들어온다.
  app.on('second-instance', (_event, argv, cwd) => {
    const files = extractPdfPaths(argv.slice(1), cwd);
    if (files.length) {
      files.forEach(openPath);
      return;
    }
    const win = BrowserWindow.getFocusedWindow() || [...windows.keys()][0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    } else {
      createWindow();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    if (!IS_MAC) app.quit();
  });

  app.on('activate', () => {
    if (windows.size === 0) createWindow();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (e) => e.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  app.whenReady().then(() => {
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      if (url.host !== 'bundle') return new Response('Not found', { status: 404 });
      let rel = decodeURIComponent(url.pathname);
      if (!rel || rel === '/') rel = '/index.html';
      const filePath = path.normalize(path.join(RENDERER_DIR, rel));
      if (!filePath.startsWith(RENDERER_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
      try {
        const data = await fsp.readFile(filePath);
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        return new Response(data, { headers: { 'content-type': type } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });

    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: 'PDF 렌더링: pdf.js (Apache-2.0) · PDF 편집: pdf-lib (MIT) · 글꼴: 나눔고딕 (SIL OFL 1.1)',
    });

    buildMenu();
    registerIpc();

    const initial = [...pendingPaths.splice(0), ...extractPdfPaths(process.argv.slice(1))];
    if (initial.length) initial.forEach(openPath);
    else createWindow();
  });
}
