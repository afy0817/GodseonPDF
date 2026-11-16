// 실제 Electron 앱을 띄워 편집 기능을 끝까지 검증하는 테스트.
//   npm run build && npm run test:e2e
// 결과물(스크린샷, 저장된 PDF)은 tests/output/ 에 남는다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import fontkit from '@cantoo/fontkit';
import { degrees, PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests', 'output');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// 1. 테스트용 PDF / 이미지 만들기
// ---------------------------------------------------------------------------
async function makeFixturePdf(file) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const ko = await doc.embedFont(fs.readFileSync(path.join(root, 'public/fonts/NanumGothic-Regular.ttf')), { subset: true });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    '갓선PDF 테스트 문서 — 첫 번째 페이지',
    '이 줄 위에 형광펜을 칠합니다. The quick brown fox jumps over the lazy dog.',
    '두 번째 문단: 대한민국 헌법 제1조 ① 대한민국은 민주공화국이다.',
    '세 번째 문단: 1234567890 !@#$%^&*() ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ];
  let p = doc.addPage([612, 792]);
  lines.forEach((t, i) => p.drawText(t, { x: 60, y: 700 - i * 28, size: 14, font: ko, color: rgb(0.1, 0.1, 0.1) }));
  p.drawRectangle({ x: 60, y: 300, width: 492, height: 200, borderColor: rgb(0.6, 0.6, 0.7), borderWidth: 1 });
  p.drawText('이미지가 들어갈 자리', { x: 240, y: 395, size: 16, font: ko, color: rgb(0.5, 0.5, 0.6) });

  p = doc.addPage([595, 842]);
  p.setRotation(degrees(90));
  p.drawText('2쪽: /Rotate 90 으로 돌아간 A4 페이지', { x: 60, y: 760, size: 16, font: ko });

  p = doc.addPage([612, 792]);
  p.setMediaBox(0, 0, 612, 792);
  p.setCropBox(50, 50, 512, 692);
  p.drawText('3쪽: CropBox 가 안쪽으로 잘린 페이지', { x: 80, y: 700, size: 16, font: ko });

  p = doc.addPage([612, 792]);
  p.drawText('4쪽: 이 페이지는 삭제됩니다 (DELETE ME)', { x: 60, y: 700, size: 18, font: ko, color: rgb(0.8, 0, 0) });

  p = doc.addPage([612, 792]);
  p.drawText('5쪽: 마지막 페이지', { x: 60, y: 700, size: 18, font: ko });
  p.drawText('Helvetica text for reference', { x: 60, y: 660, size: 12, font: helv });
  fs.writeFileSync(file, await doc.save());
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(file, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const inCircle = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (Math.min(w, h) / 2.2) ** 2;
      raw[o] = Math.round((x / w) * 255);
      raw[o + 1] = 120;
      raw[o + 2] = Math.round((y / h) * 255);
      raw[o + 3] = inCircle ? 255 : 0; // 원 밖은 투명
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(
    file,
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]),
  );
}

const pdfPath = path.join(out, 'fixture.pdf');
const imgPath = path.join(out, 'logo.png');
await makeFixturePdf(pdfPath);
fs.copyFileSync(pdfPath, path.join(out, 'fixture-original.pdf'));
makePng(imgPath, 320, 200);

// ---------------------------------------------------------------------------
// 2. 앱 실행
// ---------------------------------------------------------------------------
const app = await electron.launch({ args: [root, pdfPath], cwd: root, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } });
const win = await app.firstWindow();
const consoleErrors = [];
win.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
win.on('pageerror', (e) => consoleErrors.push(String(e)));
await win.setViewportSize({ width: 1360, height: 900 }).catch(() => {});
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 920));

await win.waitForSelector('.page canvas.pdf-canvas', { timeout: 20000 });
await win.waitForTimeout(600);
const state = () => win.evaluate(() => {
  const s = window.__godseon.store;
  return { anns: s.annotations, deleted: [...s.deleted], tool: s.tool, dirty: window.__godseon.history.dirty, zoom: s.zoom };
});
check('PDF 열기 (명령줄 인자)', (await win.locator('.page').count()) === 5, `${await win.locator('.page').count()} pages`);
check('썸네일 표시', (await win.locator('.thumb').count()) === 5);
await win.screenshot({ path: path.join(out, '01-opened.png') });

const page1 = win.locator('.page').nth(0);
let box = await page1.boundingBox();
const s1 = box.width / 612; // 화면 px / pt
const at = (x, y) => ({ x: box.x + x * s1, y: box.y + y * s1 }); // 페이지 단위(위쪽 원점) → 화면

// ---------------------------------------------------------------------------
// 3. 글자 입력
// ---------------------------------------------------------------------------
await win.click('[data-tool="text"]');
let pt = at(150, 590);
await win.mouse.click(pt.x, pt.y);
await win.waitForSelector('.ann-text.editing');
await win.keyboard.type('안녕하세요! ㈜갓선 글자 입력 ✓ 123');
await win.keyboard.press('Enter');
await win.keyboard.type('두 번째 줄 — Hello, World');
await win.keyboard.press('Escape');
let st = await state();
const textAnn = st.anns.find((a) => a.type === 'text');
check('글상자 생성 + 한글 입력', !!textAnn && textAnn.text === '안녕하세요! ㈜갓선 글자 입력 ✓ 123\n두 번째 줄 — Hello, World', JSON.stringify(textAnn?.text));

// 글자 크기/색/굵게 변경 (선택된 상태에서)
await win.selectOption('.opt-group:not([hidden]) select', '20');
await win.click('.opt-group:not([hidden]) .swatch[data-color="#2563eb"]');
await win.click('.opt-group:not([hidden]) .bold-btn');
st = await state();
const t2 = st.anns.find((a) => a.type === 'text');
check('글자 스타일 변경', t2.size === 20 && t2.color === '#2563eb' && t2.bold === true, `${t2.size} ${t2.color} ${t2.bold}`);

// 두 번째 글상자 (작은 글씨, 빨강)
await win.click('[data-tool="text"]');
pt = at(60, 740);
await win.mouse.click(pt.x, pt.y);
await win.waitForSelector('.ann-text.editing');
await win.keyboard.type('서명: 홍길동 (2026-11-16)');
await win.mouse.click(box.x + box.width - 20, box.y + box.height - 20); // 바깥 클릭으로 입력 끝내기
st = await state();
check('두 번째 글상자', st.anns.filter((a) => a.type === 'text').length === 2);

// ---------------------------------------------------------------------------
// 4. 형광펜
// ---------------------------------------------------------------------------
await win.click('[data-tool="highlight"]');
// 두 번째 줄 (pdf y=672 → 화면 위에서 792-672=120, 글자 크기 14 → 중심 ~115)
let a1 = at(56, 115);
let a2 = at(470, 115);
await win.mouse.move(a1.x, a1.y);
await win.mouse.down();
await win.mouse.move(a2.x, a2.y + 2, { steps: 25 });
await win.mouse.up();
// 초록색으로 세 번째 줄
await win.click('.opt-group:not([hidden]) .swatch[data-color="#7ff09b"]');
a1 = at(56, 143);
a2 = at(330, 143);
await win.mouse.move(a1.x, a1.y);
await win.mouse.down();
await win.mouse.move((a1.x + a2.x) / 2, a1.y - 3, { steps: 10 });
await win.mouse.move(a2.x, a2.y, { steps: 10 });
await win.mouse.up();
// 지울 획
a1 = at(100, 230);
a2 = at(300, 260);
await win.mouse.move(a1.x, a1.y);
await win.mouse.down();
await win.mouse.move(a2.x, a2.y, { steps: 12 });
await win.mouse.up();
st = await state();
check('형광펜 획 3개', st.anns.filter((a) => a.type === 'highlight').length === 3);

// 지우개로 세 번째 획 지우기
await win.click('[data-tool="eraser"]');
a1 = at(200, 220);
a2 = at(200, 270);
await win.mouse.move(a1.x, a1.y);
await win.mouse.down();
await win.mouse.move(a2.x, a2.y, { steps: 10 });
await win.mouse.up();
st = await state();
check('지우개로 획 삭제', st.anns.filter((a) => a.type === 'highlight').length === 2);

// ---------------------------------------------------------------------------
// 5. 이미지 첨부 (+ 이동, 크기 조절)
// ---------------------------------------------------------------------------
await win.click('[data-tool="select"]');
await win.setInputFiles('#image-input', imgPath);
await win.waitForSelector('.ann-image.selected');
st = await state();
let img = st.anns.find((a) => a.type === 'image');
check('이미지 삽입', !!img, img ? `${img.w.toFixed(1)}x${img.h.toFixed(1)} on page ${img.page + 1}` : '');
// 이미지를 1쪽 상자 안으로 끌어 옮기기
let imgBox = await win.locator('.ann-image').boundingBox();
const target = at(306, 392);
await win.mouse.move(imgBox.x + imgBox.width / 2, imgBox.y + imgBox.height / 2);
await win.mouse.down();
await win.mouse.move(target.x, target.y, { steps: 15 });
await win.mouse.up();
// 오른쪽 아래 모서리로 크기 조절
imgBox = await win.locator('.ann-image').boundingBox();
await win.mouse.move(imgBox.x + imgBox.width, imgBox.y + imgBox.height);
await win.mouse.down();
await win.mouse.move(imgBox.x + imgBox.width * 0.8, imgBox.y + imgBox.height * 0.8, { steps: 8 });
await win.mouse.up();
st = await state();
img = st.anns.find((a) => a.type === 'image');
check('이미지 이동/크기 조절', img.page === 0 && Math.abs(img.w / img.h - 320 / 200) < 0.01, `x=${img.x.toFixed(1)} y=${img.y.toFixed(1)} w=${img.w.toFixed(1)} h=${img.h.toFixed(1)}`);

// ---------------------------------------------------------------------------
// 6. 실행 취소 / 다시 실행
// ---------------------------------------------------------------------------
const before = (await state()).anns.length;
await win.click('[data-cmd="undo"]');
await win.click('[data-cmd="undo"]');
const afterUndo = await state();
await win.click('[data-cmd="redo"]');
await win.click('[data-cmd="redo"]');
const afterRedo = await state();
check('실행 취소/다시 실행', JSON.stringify(afterRedo.anns) === JSON.stringify(st.anns) && afterUndo.anns.length <= before, `undo→${afterUndo.anns.length}, redo→${afterRedo.anns.length}`);

// ---------------------------------------------------------------------------
// 7. 회전된 페이지 / 잘린 페이지에도 편집
// ---------------------------------------------------------------------------
await win.locator('.thumb[data-index="1"]').click();
await win.waitForTimeout(400);
const page2 = win.locator('.page').nth(1);
const b2 = await page2.boundingBox();
const s2 = b2.width / 842;
await win.click('[data-tool="text"]');
await win.mouse.click(b2.x + 60 * s2, b2.y + 120 * s2);
await win.waitForSelector('.ann-text.editing');
await win.keyboard.type('회전된 페이지에 쓴 글자 (가로로 보여야 함)');
await win.keyboard.press('Escape');
await win.click('[data-tool="highlight"]');
await win.mouse.move(b2.x + 60 * s2, b2.y + 200 * s2);
await win.mouse.down();
await win.mouse.move(b2.x + 500 * s2, b2.y + 200 * s2, { steps: 15 });
await win.mouse.up();

await win.locator('.thumb[data-index="2"]').click();
await win.waitForTimeout(400);
const page3 = win.locator('.page').nth(2);
const b3 = await page3.boundingBox();
const s3 = b3.width / 512;
await win.click('[data-tool="text"]');
await win.mouse.click(b3.x + 30 * s3, b3.y + 60 * s3);
await win.waitForSelector('.ann-text.editing');
await win.keyboard.type('잘린(CropBox) 페이지의 왼쪽 위 근처');
await win.keyboard.press('Escape');
await win.click('[data-tool="select"]');

// ---------------------------------------------------------------------------
// 7-1. 표 추가·편집 (5쪽)
// ---------------------------------------------------------------------------
await win.locator('.thumb[data-index="4"]').click();
await win.waitForTimeout(400);
const page5 = win.locator('.page').nth(4);
let b5 = await page5.boundingBox();
const s5 = b5.width / 612;
await win.click('[data-tool="table"]');
await win.click('button[title="열 늘리기"]'); // 3열 → 4열
await win.mouse.click(b5.x + 60 * s5, b5.y + 150 * s5);
await win.waitForSelector('.tbl-cell.editing');
const typeCells = async (values) => {
  for (const v of values) {
    if (v) await win.keyboard.type(v);
    await win.keyboard.press('Tab');
  }
};
await typeCells(['항목', '수량', '단가', '비고']);
await typeCells(['사과', '3', '1,500원', '㈜과일상회 납품 — 긴 문장은 칸 너비에 맞춰 자동으로 줄이 바뀝니다']);
await typeCells(['배', '12', '3,000원', '']); // 마지막 칸에서 Tab → 행이 하나 늘어난다
await win.keyboard.type('합계');
await win.keyboard.press('Escape');
st = await state();
let tbl = st.anns.find((a) => a.type === 'table');
check(
  '표 생성 + Tab 으로 칸 이동 (마지막 칸 Tab → 행 추가)',
  !!tbl && tbl.rows.length === 4 && tbl.cols.length === 4 && tbl.cells[0].join('|') === '항목|수량|단가|비고' && tbl.cells[3][0] === '합계',
  tbl ? `${tbl.rows.length}x${tbl.cols.length} ${JSON.stringify(tbl.cells)}` : 'no table',
);
const wrapped = await win.locator('.tbl-cell[data-r="1"][data-c="3"] .tbl-text').textContent();
check('긴 글자 자동 줄바꿈', wrapped.includes('\n'), JSON.stringify(wrapped));
await win.click('button:has-text("머리글 행")');
await win.click('button[title="가운데 정렬"]');
await win.click('button:has-text("열 추가")');
let colsAfterAdd = (await state()).anns.find((a) => a.type === 'table').cols.length;
await win.click('button:has-text("열 삭제")');
st = await state();
tbl = st.anns.find((a) => a.type === 'table');
check('머리글·가운데 정렬·열 추가/삭제', tbl.header && tbl.align === 'center' && colsAfterAdd === 5 && tbl.cols.length === 4, `cols ${colsAfterAdd}→${tbl.cols.length}`);
// 첫 열 경계선을 오른쪽으로 30pt 끌기
const w0 = tbl.cols[0];
const handle = await win.locator('.ann-table .tbl-col-handle[data-col="1"]').boundingBox();
await win.mouse.move(handle.x + handle.width / 2, handle.y + 20);
await win.mouse.down();
await win.mouse.move(handle.x + handle.width / 2 + 30 * s5, handle.y + 20, { steps: 8 });
await win.mouse.up();
// 손잡이로 표 옮기기
const grip = await win.locator('.ann-table .tbl-grip').boundingBox();
const x0 = tbl.x;
await win.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
await win.mouse.down();
await win.mouse.move(grip.x + grip.width / 2 + 20 * s5, grip.y + grip.height / 2 + 10 * s5, { steps: 8 });
await win.mouse.up();
st = await state();
tbl = st.anns.find((a) => a.type === 'table');
check('열 너비 조절 + 표 이동', Math.abs(tbl.cols[0] - w0 - 30) < 2 && Math.abs(tbl.x - x0 - 20) < 2, `col0 ${w0.toFixed(1)}→${tbl.cols[0].toFixed(1)}, x ${x0.toFixed(1)}→${tbl.x.toFixed(1)}`);
await page5.screenshot({ path: path.join(out, '06-table-screen.png') });

// ---------------------------------------------------------------------------
// 8. 페이지 삭제 (4쪽)
// ---------------------------------------------------------------------------
await win.locator('.thumb[data-index="3"]').scrollIntoViewIfNeeded();
await win.locator('.thumb[data-index="3"]').hover();
await win.click('.thumb[data-index="3"] .thumb-del');
st = await state();
check('페이지 삭제', st.deleted.length === 1 && st.deleted[0] === 3 && (await win.locator('.thumb:not([hidden])').count()) === 4);
check('변경 표시(dirty)', st.dirty === true);

// 1쪽으로 돌아가 화면 캡처
await win.locator('.thumb[data-index="0"]').click();
await win.waitForTimeout(500);
await win.click('[data-cmd="zoomFit"]');
await win.waitForTimeout(700);
await win.screenshot({ path: path.join(out, '02-edited.png') });
await page1.screenshot({ path: path.join(out, '03-page1-screen.png') });

// ---------------------------------------------------------------------------
// 9. 저장 (원본 위치에 덮어쓰기)
// ---------------------------------------------------------------------------
await win.click('[data-cmd="save"]');
await win.waitForSelector('.toast-success', { timeout: 20000 });
st = await state();
check('저장 완료 + dirty 해제', st.dirty === false);

const saved = await PDFDocument.load(fs.readFileSync(pdfPath));
check('저장된 PDF 페이지 수 4', saved.getPageCount() === 4, `${saved.getPageCount()}`);
fs.copyFileSync(pdfPath, path.join(out, 'saved.pdf'));

// 화면과 같은 배율로 렌더링 (화면 캡처와 비교용)
const p1px = Math.round((await page1.boundingBox()).width);
execFileSync('pdftoppm', ['-png', '-cropbox', '-scale-to-x', String(p1px), '-scale-to-y', '-1', '-f', '1', '-l', '1', pdfPath, path.join(out, '04-page1-saved')]);
execFileSync('pdftoppm', ['-png', '-cropbox', '-r', '60', pdfPath, path.join(out, '05-saved')]);
const text = execFileSync('pdftotext', ['-layout', pdfPath, '-']).toString();
check('저장된 PDF에 한글 텍스트(검색 가능)', text.includes('안녕하세요! ㈜갓선 글자 입력 ✓ 123') && text.includes('회전된 페이지에 쓴 글자'));
check('삭제한 페이지 내용 없음', !text.includes('DELETE ME'));
check('저장된 PDF에 표 내용', ['항목', '수량', '단가', '비고', '사과', '1,500원', '합계', '㈜과일상회'].every((w) => text.includes(w)));
execFileSync('pdftoppm', ['-png', '-cropbox', '-r', '110', '-f', '4', '-l', '4', pdfPath, path.join(out, '07-table-saved')]);

// 글상자 위치 정밀도: 저장된 PDF에서 첫 단어의 왼쪽 끝(xMin)과 기준선이 화면 좌표와 일치하는지
{
  const finalState = await state();
  const t = finalState.anns.find((a) => a.type === 'text' && a.text.startsWith('안녕하세요'));
  const bbox = execFileSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', pdfPath, '-']).toString();
  const m = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">안녕하세요!<\/word>/.exec(bbox);
  const dx = m ? Math.abs(Number(m[1]) - t.x) : Infinity;
  check('글자 위치가 화면과 일치 (가로 오차 < 1.5pt)', dx < 1.5, m ? `screen x=${t.x.toFixed(2)} pdf xMin=${Number(m[1]).toFixed(2)} (Δ${dx.toFixed(2)}pt)` : 'word not found');
}

// ---------------------------------------------------------------------------
// 10. 저장 후 계속 편집해도 중복으로 그려지지 않는지 (원본 기준 재생성)
// ---------------------------------------------------------------------------
await win.click('[data-cmd="save"]');
await win.waitForTimeout(1500);
const text2 = execFileSync('pdftotext', [pdfPath, '-']).toString();
const count = text2.split('두 번째 줄').length - 1;
check('다시 저장해도 글자가 한 번만 들어감', count === 1, `count=${count}`);

check('렌더러 콘솔 오류 없음', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await app.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. 결과물: ${path.relative(root, out)}/`);
process.exit(failed.length ? 1 : 0);
