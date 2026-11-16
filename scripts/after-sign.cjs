// electron-builder afterSign 훅 (윈도우).
// electron-builder(resedit)는 실행 파일의 ProductVersion 문자열을 항상 4자리(1.2.0.0)로 바꿔 쓴다.
// SignPath 서명 요청은 제품 버전을 워크플로가 넘기는 숫자 버전(1.2.0)으로 확인하므로 (GodseonSync 와 같이),
// package.json 의 shortVersionWindows 가 있으면 그 값으로 문자열을 맞춘다. (실제 코드 서명은 이후 SignPath 에서)
'use strict';
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { appInfo } = context.packager;
  const version = appInfo.shortVersionWindows;
  if (!version) return;
  const ResEdit = require('resedit');
  const exe = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const executable = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(executable);
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (!vi) return;
  for (const lang of vi.getAllLanguagesForStringValues()) vi.setStringValues(lang, { ProductVersion: version });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(executable);
  fs.writeFileSync(exe, Buffer.from(executable.generate()));
  console.log(`  • ProductVersion  ${path.basename(exe)} → ${version}`);
};
