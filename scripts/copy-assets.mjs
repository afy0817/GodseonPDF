// pdf.js가 런타임에 필요로 하는 리소스(CMap, 표준 폰트, wasm 디코더, ICC)를 public/pdfjs 로 복사한다.
// 한글/일본어/중국어 PDF 중 폰트가 내장되지 않은 문서는 CMap 이 없으면 글자가 보이지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pdfjsDir = path.join(root, 'node_modules', 'pdfjs-dist');
const outDir = path.join(root, 'public', 'pdfjs');

const dirs = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
// PDF 안의 JavaScript 실행용 엔진은 쓰지 않으므로 제외
const skip = (name) => name.startsWith('quickjs');

fs.rmSync(outDir, { recursive: true, force: true });
for (const dir of dirs) {
  const src = path.join(pdfjsDir, dir);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(outDir, dir);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (skip(name)) continue;
    fs.copyFileSync(path.join(src, name), path.join(dest, name));
  }
}
console.log('[copy-assets] pdf.js assets → public/pdfjs');
