'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { translate } = require('./i18n.cjs');
const { createFontStore } = require('./fonts.cjs');
const { createSignatureStore } = require('./signatures.cjs');

const APP_NAME = 'GodseonPDF';
const IS_MAC = process.platform === 'darwin';
const DEV_URL = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIR = path.join(__dirname, '..', 'dist', 'renderer');
const APP_URL = 'app://bundle/index.html';

app.setName(APP_NAME);
// 자동 테스트가 사용자 설정을 건드리지 않도록 따로 지정할 수 있다
if (process.env.GODSEON_USER_DATA) app.setPath('userData', process.env.GODSEON_USER_DATA);

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
// 설정 / 언어
// ---------------------------------------------------------------------------

/** @type {'ko' | 'en'} */
let lang = 'ko';

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2));
  } catch (err) {
    console.warn('settings:', err);
  }
}

/** 처음 언어: 테스트용 환경 변수 → 저장된 설정 → OS 언어 */
function initialLanguage() {
  const env = process.env.GODSEON_LANG;
  if (env === 'ko' || env === 'en') return env;
  const saved = readSettings().language;
  if (saved === 'ko' || saved === 'en') return saved;
  return /^ko\b/i.test(app.getLocale()) ? 'ko' : 'en';
}

const T = (key, params) => translate(lang, key, { app: APP_NAME, ...params });
const fontStore = createFontStore(app, T);
const signatureStore = createSignatureStore(app, T);

function setLanguage(next) {
  if ((next !== 'ko' && next !== 'en') || next === lang) return;
  lang = next;
  writeSettings({ language: next });
  buildMenu();
  for (const win of windows.keys()) send(win, 'app:language', next);
}

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
  if (!head.includes('%PDF')) throw new Error(T('err.notPdf'));
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
        throw new Error(T('err.cannotWrite'));
      }
      throw err2 || err;
    }
  }
}

/** 파일 이름에 쓸 수 없는 문자(윈도우 기준)를 바꾼다 */
function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim() || 'export';
}

// 이미지로 내보내기 중인 작업 (id → 상태). 취소·실패·종료 때 쓰다 만 파일을 지운다.
const exportSessions = new Map();
const exportedPaths = new Set();

async function discardExport(s) {
  try {
    if (s.mode === 'file') {
      await s.handle.close().catch(() => {});
      await fsp.rm(s.tmp ?? s.target, { force: true });
    } else {
      // 우리가 쓴 파일만 지우고, 폴더는 비어 있을 때만 지운다
      for (const f of s.files) await fsp.rm(path.join(s.dir, f), { force: true });
      await fsp.rmdir(s.dir).catch(() => {});
    }
  } catch {
    /* 지우지 못해도 그대로 둔다 */
  }
}

function discardExportsSync() {
  for (const s of exportSessions.values()) {
    try {
      if (s.mode === 'file') {
        fs.closeSync(s.handle.fd);
        fs.rmSync(s.tmp ?? s.target, { force: true });
      } else {
        for (const f of s.files) fs.rmSync(path.join(s.dir, f), { force: true });
        fs.rmdirSync(s.dir);
      }
    } catch {
      /* 무시 */
    }
  }
  exportSessions.clear();
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

function unsavedDialog(win, name) {
  return dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [T('dlg.save'), T('dlg.discard'), T('dlg.cancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: T('dlg.unsavedMessage', { name }),
    detail: T('dlg.unsavedDetail'),
  });
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
    // 맥: 창 버튼을 맨 위 제목 줄(38px) 가운데 높이에 둔다
    trafficLightPosition: IS_MAC ? { x: 14, y: 12 } : undefined,
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
  // 페이지 <title> 대신 항상 앱 이름 (문서를 열면 '문서 이름 — GodseonPDF')
  win.on('page-title-updated', (event) => event.preventDefault());

  win.on('close', (event) => {
    const st = stateOf(win);
    if (!st || st.allowClose || !st.dirty) return;
    event.preventDefault();
    if (st.closing) return;
    st.closing = true;
    unsavedDialog(win, st.title).then(({ response }) => {
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
    dialog.showErrorBox(T('err.cannotOpen'), `${filePath}\n\n${err.message}`);
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
        { role: 'about', label: T('menu.about') },
        { type: 'separator' },
        { role: 'services', label: T('menu.services') },
        { type: 'separator' },
        { role: 'hide', label: T('menu.hide') },
        { role: 'hideOthers', label: T('menu.hideOthers') },
        { role: 'unhide', label: T('menu.unhide') },
        { type: 'separator' },
        { role: 'quit', label: T('menu.quitApp') },
      ],
    });
  }
  template.push(
    {
      label: T('menu.file'),
      submenu: [
        { label: T('menu.newWindow'), accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: T('menu.open'), accelerator: 'CmdOrCtrl+O', click: cmd('open') },
        { type: 'separator' },
        { label: T('menu.save'), accelerator: 'CmdOrCtrl+S', click: cmd('save') },
        { label: T('menu.saveAs'), accelerator: 'CmdOrCtrl+Shift+S', click: cmd('saveAs') },
        { label: T('menu.exportImages'), accelerator: 'CmdOrCtrl+Shift+E', click: cmd('exportImages') },
        { type: 'separator' },
        { role: 'close', label: T('menu.close') },
        ...(IS_MAC ? [] : [{ type: 'separator' }, { role: 'quit', label: T('menu.quit') }]),
      ],
    },
    {
      label: T('menu.edit'),
      submenu: [
        { label: T('menu.undo'), accelerator: 'CmdOrCtrl+Z', click: cmd('undo') },
        { label: T('menu.redo'), accelerator: IS_MAC ? 'Shift+Cmd+Z' : 'Ctrl+Y', click: cmd('redo') },
        ...(IS_MAC ? [] : [{ label: T('menu.redo'), accelerator: 'Ctrl+Shift+Z', visible: false, click: cmd('redo') }]),
        { type: 'separator' },
        { role: 'cut', label: T('menu.cut') },
        { role: 'copy', label: T('menu.copy') },
        { role: 'paste', label: T('menu.paste') },
        { role: 'selectAll', label: T('menu.selectAll') },
      ],
    },
    {
      label: T('menu.view'),
      submenu: [
        { label: T('menu.zoomIn'), accelerator: 'CmdOrCtrl+=', click: cmd('zoomIn') },
        { label: T('menu.zoomIn'), accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: cmd('zoomIn') },
        { label: T('menu.zoomIn'), accelerator: 'CmdOrCtrl+numadd', visible: false, acceleratorWorksWhenHidden: true, click: cmd('zoomIn') },
        { label: T('menu.zoomOut'), accelerator: 'CmdOrCtrl+-', click: cmd('zoomOut') },
        { label: T('menu.zoomOut'), accelerator: 'CmdOrCtrl+numsub', visible: false, acceleratorWorksWhenHidden: true, click: cmd('zoomOut') },
        { label: T('menu.actualSize'), accelerator: 'CmdOrCtrl+0', click: cmd('zoomReset') },
        { label: T('menu.fitWidth'), accelerator: 'CmdOrCtrl+9', click: cmd('zoomFit') },
        { type: 'separator' },
        { label: T('menu.sidebar'), click: cmd('toggleSidebar') },
        {
          label: T('menu.language'),
          submenu: [
            { label: '한국어', type: 'radio', checked: lang === 'ko', click: () => setLanguage('ko') },
            { label: 'English', type: 'radio', checked: lang === 'en', click: () => setLanguage('en') },
          ],
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: T('menu.fullscreen') },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools', label: T('menu.devtools') }]),
      ],
    },
    {
      label: T('menu.tools'),
      submenu: [
        { label: T('menu.select'), click: cmd('tool:select') },
        { label: T('menu.text'), click: cmd('tool:text') },
        { label: T('menu.editText'), click: cmd('tool:edit') },
        { label: T('menu.highlight'), click: cmd('tool:highlight') },
        { label: T('menu.eraser'), click: cmd('tool:eraser') },
        { label: T('menu.table'), click: cmd('tool:table') },
        { type: 'separator' },
        { label: T('menu.insertImage'), click: cmd('insertImage') },
        { label: T('menu.signatures'), click: cmd('toggleSignatures') },
        { label: T('menu.newSignature'), click: cmd('newSignature') },
        { label: T('menu.convertFonts'), click: cmd('convertFonts') },
        { label: T('menu.deletePages'), click: cmd('deletePages') },
      ],
    },
  );
  if (IS_MAC) template.push({ role: 'windowMenu', label: T('menu.window') });
  template.push({
    role: 'help',
    label: T('menu.help'),
    submenu: [{ label: T('menu.about'), click: () => app.showAboutPanel() }],
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: T('about.credits'),
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  const winOf = (event) => BrowserWindow.fromWebContents(event.sender);

  ipcMain.handle('pdf:open-dialog', async (event) => {
    const win = winOf(event);
    const result = await dialog.showOpenDialog(win, {
      title: T('dlg.openTitle'),
      properties: ['openFile'],
      filters: [{ name: T('dlg.pdfFilter'), extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = await readPdf(result.filePaths[0]);
    app.addRecentDocument(file.path);
    return file;
  });

  ipcMain.handle('pdf:open-path', async (_event, filePath) => {
    if (!isPdfPath(filePath)) throw new Error(T('err.pdfOnly'));
    const file = await readPdf(filePath);
    app.addRecentDocument(file.path);
    return file;
  });

  ipcMain.handle('pdf:save', async (_event, { path: filePath, data }) => {
    if (!isPdfPath(filePath)) throw new Error(T('err.badPath'));
    if (!(data instanceof Uint8Array)) throw new Error(T('err.badData'));
    await writeFileSafely(filePath, data);
    return { path: filePath, name: path.basename(filePath) };
  });

  ipcMain.handle('pdf:save-as', async (event, { data, suggestedName, defaultDir }) => {
    if (!(data instanceof Uint8Array)) throw new Error(T('err.badData'));
    const win = winOf(event);
    const name = typeof suggestedName === 'string' && suggestedName ? suggestedName : T('dlg.defaultName');
    const dir = typeof defaultDir === 'string' && path.isAbsolute(defaultDir) ? defaultDir : app.getPath('documents');
    const result = await dialog.showSaveDialog(win, {
      title: T('dlg.saveAsTitle'),
      defaultPath: path.join(dir, name),
      filters: [{ name: T('dlg.pdfFilter'), extensions: ['pdf'] }],
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
    const { response } = await unsavedDialog(winOf(event), docName);
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

  // 이미지로 내보내기 — 렌더러가 한 장씩 보내면 바로 디스크에 쓴다 (큰 문서도 메모리를 적게 쓰도록)
  //   file  : ZIP 하나 또는 이미지 한 장. 같은 폴더의 임시 파일에 이어 쓰고, 다 쓰면 이름을 바꾼다.
  //   folder: 고른 폴더 안에 '문서이름_images' 폴더를 새로 만들어 낱장으로 쓴다 (있으면 번호를 붙인다).
  // GODSEON_TEST_SAVE_DIR: 자동 테스트용 — 대화상자 없이 그 폴더에 저장
  const testDir = process.env.GODSEON_TEST_SAVE_DIR;
  const FILTERS = {
    zip: [{ name: 'ZIP', extensions: ['zip'] }],
    png: [{ name: 'PNG', extensions: ['png'] }],
    jpg: [{ name: 'JPEG', extensions: ['jpg', 'jpeg'] }],
  };
  const startDir = (defaultDir) => (typeof defaultDir === 'string' && path.isAbsolute(defaultDir) ? defaultDir : app.getPath('documents'));

  ipcMain.handle('export:begin', async (event, { mode, name, kind, defaultDir }) => {
    const base = safeFileName(path.basename(String(name || 'export')));
    const id = crypto.randomUUID();
    let session;
    if (mode === 'folder') {
      let parent = testDir;
      if (!parent) {
        const r = await dialog.showOpenDialog(winOf(event), {
          title: T('dlg.chooseFolder'),
          buttonLabel: T('dlg.chooseFolderButton'),
          defaultPath: startDir(defaultDir),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (r.canceled || !r.filePaths[0]) return null;
        parent = r.filePaths[0];
      }
      let dir = path.join(parent, base);
      for (let n = 2; fs.existsSync(dir); n++) dir = path.join(parent, `${base} (${n})`);
      try {
        await fsp.mkdir(dir, { recursive: true });
      } catch {
        throw new Error(T('err.cannotWrite'));
      }
      session = { mode: 'folder', dir, files: [] };
    } else {
      const filters = FILTERS[kind] || [];
      let target;
      if (testDir) target = path.join(testDir, base);
      else {
        const r = await dialog.showSaveDialog(winOf(event), {
          title: T('dlg.exportTitle'),
          defaultPath: path.join(startDir(defaultDir), base),
          filters,
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        });
        if (r.canceled || !r.filePath) return null;
        target = r.filePath;
        const ext = filters[0]?.extensions ?? [];
        if (ext.length && !ext.some((e) => target.toLowerCase().endsWith(`.${e}`))) target += `.${ext[0]}`;
      }
      // 임시 파일을 만들 수 없는 폴더(권한, 클라우드 동기화 폴더 등)에서는 바로 쓴다
      let tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}-${Date.now()}.part`);
      let handle;
      try {
        handle = await fsp.open(tmp, 'w');
      } catch {
        tmp = null;
        try {
          handle = await fsp.open(target, 'w');
        } catch {
          throw new Error(T('err.cannotWrite'));
        }
      }
      session = { mode: 'file', target, tmp, handle };
    }
    exportSessions.set(id, session);
    // 창이 닫히면 쓰다 만 파일을 지운다
    event.sender.once('destroyed', () => {
      if (exportSessions.get(id) === session) {
        exportSessions.delete(id);
        discardExport(session);
      }
    });
    const out = session.mode === 'folder' ? session.dir : session.target;
    return { id, path: out, name: path.basename(out) };
  });

  ipcMain.handle('export:write', async (_event, { id, name, chunks }) => {
    const s = exportSessions.get(id);
    if (!s || !Array.isArray(chunks) || !chunks.every((c) => c instanceof Uint8Array)) throw new Error(T('err.badData'));
    const bufs = chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength));
    try {
      if (s.mode === 'folder') {
        const file = safeFileName(path.basename(String(name)));
        await fsp.writeFile(path.join(s.dir, file), Buffer.concat(bufs));
        s.files.push(file);
      } else {
        for (const buf of bufs) {
          for (let off = 0; off < buf.length; ) off += (await s.handle.write(buf, off, buf.length - off, null)).bytesWritten;
        }
      }
    } catch {
      throw new Error(T('err.cannotWrite'));
    }
  });

  ipcMain.handle('export:finish', async (_event, id) => {
    const s = exportSessions.get(id);
    if (!s) throw new Error(T('err.badData'));
    exportSessions.delete(id);
    let out = s.dir;
    if (s.mode === 'file') {
      out = s.target;
      try {
        await s.handle.close();
        if (s.tmp) {
          try {
            await fsp.rename(s.tmp, s.target);
          } catch {
            // 대상 파일이 다른 프로그램에 열려 있으면(윈도우) 이름 바꾸기가 안 되므로 복사해 덮어쓴다
            await fsp.copyFile(s.tmp, s.target);
            await fsp.rm(s.tmp, { force: true });
          }
        }
      } catch {
        await discardExport(s);
        throw new Error(T('err.cannotWrite'));
      }
    }
    exportedPaths.add(out);
    return { path: out, name: path.basename(out) };
  });

  ipcMain.handle('export:abort', async (_event, id) => {
    const s = exportSessions.get(id);
    if (!s) return;
    exportSessions.delete(id);
    await discardExport(s);
  });

  // 방금 내보낸 결과만 탐색기·Finder 로 보여 준다
  ipcMain.handle('export:reveal', async (_event, p) => {
    if (typeof p !== 'string' || !exportedPaths.has(p)) return;
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) await shell.openPath(p);
    else shell.showItemInFolder(p);
  });

  // 사용자가 추가한 글꼴
  ipcMain.handle('fonts:list', () => fontStore.list());
  ipcMain.handle('fonts:normalize', (_event, data) => fontStore.normalize(data));
  ipcMain.handle('fonts:save', (_event, payload) => fontStore.save(payload));
  ipcMain.handle('fonts:remove', (_event, id) => fontStore.remove(id));

  // 서명 서랍
  ipcMain.handle('signatures:list', () => signatureStore.list());
  ipcMain.handle('signatures:save', (_event, payload) => signatureStore.save(payload ?? {}));
  ipcMain.handle('signatures:remove', (_event, id) => signatureStore.remove(String(id)));

  ipcMain.on('app:get-language', (event) => {
    event.returnValue = lang;
  });

  ipcMain.on('app:set-language', (_event, next) => setLanguage(next));

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

  app.on('will-quit', discardExportsSync);

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

    lang = initialLanguage();
    buildMenu();
    registerIpc();

    // 개발 모드(macOS)에서도 Dock 에 GodseonPDF 아이콘이 보이도록
    if (IS_MAC && !app.isPackaged && app.dock) {
      const icon = path.join(__dirname, '..', 'build', 'icon.png');
      if (fs.existsSync(icon)) app.dock.setIcon(icon);
    }

    const initial = [...pendingPaths.splice(0), ...extractPdfPaths(process.argv.slice(1))];
    if (initial.length) initial.forEach(openPath);
    else createWindow();
  });
}
