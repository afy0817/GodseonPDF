// build/icon.svg 로 앱 아이콘을 만든다. (Electron 으로 실행: npx electron scripts/make-icons.cjs)
//   build/icon.png   1024px  — electron-builder 가 맥(icns)·리눅스 아이콘을 여기서 만든다
//   build/icon.ico   16~256px — 윈도우 실행 파일·Inno Setup 설치 파일
//   public/icon.png  256px   — 창 아이콘(리눅스), 파비콘
'use strict';
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');

function ico(images) {
  // PNG 를 그대로 담는 ICO (Windows Vista 이상)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(1);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const shot = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const base = shot.resize({ width: 1024, height: 1024, quality: 'best' });
  const png = (size) => (size === 1024 ? base : base.resize({ width: size, height: size, quality: 'best' })).toPNG();

  fs.writeFileSync(path.join(root, 'build', 'icon.png'), png(1024));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'icon.png'), png(256));
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) }))));
  console.log('icons → build/icon.png, build/icon.ico, public/icon.png');
  void nativeImage;
  app.quit();
});
