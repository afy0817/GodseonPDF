// electron-builder afterPack 훅.
// macOS: Apple 개발자 인증서가 없으므로 앱 전체를 임시(ad-hoc) 서명한다 (GodseonSync 와 같은 방식).
// 서명이 아예 깨진 앱은 "손상됨" 으로 막히지만, ad-hoc 서명은 처음 한 번 '확인 없이 열기' 로 실행할 수 있다.
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed  ${path.basename(app)}`);
};
