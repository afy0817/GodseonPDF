// 개발용 Electron 실행 파일 경로.
// macOS 에서는 기본 Electron.app 을 그대로 띄우면 메뉴 막대·Dock 에 "Electron" 이 보이므로,
// 이름(CFBundleName)과 아이콘을 GodseonPDF 로 바꾼 사본을 node_modules/.cache 에 만들어 쓴다.
// (APFS 복제로 복사하므로 디스크를 거의 쓰지 않고, Electron 버전이나 아이콘이 바뀔 때만 다시 만든다.)
// 배포용으로 빌드한 앱은 electron-builder 가 이름을 넣으므로 이 과정이 필요 없다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronPath from 'electron';

const NAME = 'GodseonPDF';

function makeIcns(png, out) {
  const set = fs.mkdtempSync(path.join(os.tmpdir(), 'godseon-icon-')) + '/icon.iconset';
  fs.mkdirSync(set);
  for (const size of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(size), String(size), png, '--out', `${set}/icon_${size}x${size}.png`], { stdio: 'ignore' });
    execFileSync('sips', ['-z', String(size * 2), String(size * 2), png, '--out', `${set}/icon_${size}x${size}@2x.png`], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', out]);
  fs.rmSync(path.dirname(set), { recursive: true, force: true });
}

export function electronBinary(root) {
  if (process.platform !== 'darwin') return electronPath;
  try {
    const srcApp = path.resolve(path.dirname(electronPath), '..', '..');
    const outDir = path.join(root, 'node_modules', '.cache', 'godseon-dev');
    const app = path.join(outDir, `${NAME}.app`);
    const iconPng = path.join(root, 'build', 'icon.png');
    const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
    const stamp = JSON.stringify({ electronVersion, icon: fs.existsSync(iconPng) ? fs.statSync(iconPng).mtimeMs : 0 });
    const stampFile = path.join(outDir, 'stamp.json');
    const current = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8') : '';
    if (current !== stamp || !fs.existsSync(app)) {
      console.log(`[dev] ${NAME} 이름으로 개발용 Electron 앱을 준비합니다…`);
      fs.rmSync(app, { recursive: true, force: true });
      fs.mkdirSync(outDir, { recursive: true });
      try {
        execFileSync('cp', ['-cR', srcApp, app]); // APFS 복제
      } catch {
        execFileSync('cp', ['-R', srcApp, app]);
      }
      const plist = path.join(app, 'Contents', 'Info.plist');
      for (const [key, value] of [
        ['CFBundleName', NAME],
        ['CFBundleDisplayName', NAME],
        ['CFBundleIdentifier', 'io.github.afy0817.godseonpdf.dev'],
      ]) {
        execFileSync('plutil', ['-replace', key, '-string', value, plist]);
      }
      if (fs.existsSync(iconPng)) {
        const iconName = execFileSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', plist]).toString().trim() || 'electron.icns';
        makeIcns(iconPng, path.join(app, 'Contents', 'Resources', iconName.endsWith('.icns') ? iconName : `${iconName}.icns`));
      }
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
      fs.writeFileSync(stampFile, stamp);
    }
    return path.join(app, 'Contents', 'MacOS', path.basename(electronPath));
  } catch (err) {
    console.warn(`[dev] 앱 이름을 바꾸지 못해 기본 Electron 으로 실행합니다: ${err.message}`);
    return electronPath;
  }
}
