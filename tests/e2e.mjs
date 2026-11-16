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
const userData = fs.mkdtempSync(path.join(out, 'userdata-'));
const exportDir = path.join(out, 'export'); // 이미지로 내보내기 결과 (대화상자 없이 여기에 저장)
fs.mkdirSync(exportDir, { recursive: true });
const app = await electron.launch({
  args: [root, pdfPath],
  cwd: root,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0', GODSEON_LANG: 'ko', GODSEON_USER_DATA: userData, GODSEON_TEST_SAVE_DIR: exportDir },
});
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
// 페이지 단위(위쪽 원점) → 화면 좌표. 화면 밖이면 보기 영역을 스크롤해서 보이게 한다.
const at = async (x, y) => {
  box = await page1.boundingBox();
  let py = box.y + y * s1;
  const vb = await win.locator('#viewer').boundingBox();
  if (py < vb.y + 30 || py > vb.y + vb.height - 30) {
    await win.locator('#viewer').evaluate((el, dy) => el.scrollBy(0, dy), py - (vb.y + vb.height / 2));
    await win.waitForTimeout(150);
    box = await page1.boundingBox();
    py = box.y + y * s1;
  }
  return { x: box.x + x * s1, y: py };
};

// ---------------------------------------------------------------------------
// 3. 글자 입력
// ---------------------------------------------------------------------------
await win.click('[data-tool="text"]');
let pt = await at(150, 590);
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

// 두 번째 글상자: 입력하는 중에 손잡이·점선 테두리로 옮기고, 놓은 뒤 이어서 입력
{
  await win.click('[data-tool="text"]');
  pt = await at(60, 740);
  await win.mouse.click(pt.x, pt.y);
  await win.waitForSelector('.ann-text.editing');
  await win.keyboard.type('서명: 홍길동');
  const second = async () => (await state()).anns.filter((a) => a.type === 'text')[1];
  const dragBy = async (from, dx, dy) => {
    await win.mouse.move(from.x, from.y);
    await win.mouse.down();
    await win.mouse.move(from.x + dx * s1, from.y + dy * s1, { steps: 8 });
    await win.mouse.up();
  };
  const near = (a, b, dx, dy) => Math.abs(b.x - a.x - dx) < 0.6 && Math.abs(b.y - a.y - dy) < 0.6;
  const q0 = await second();
  const gb = await win.locator('.ann-text.editing > .ann-grip').boundingBox();
  await dragBy({ x: gb.x + gb.width / 2, y: gb.y + gb.height / 2 }, 40, -20); // 왼쪽 위 손잡이
  await win.keyboard.type(' (2026');
  const q1 = await second();
  const eb = await win.locator('.ann-text.editing').boundingBox();
  await dragBy({ x: eb.x - 4, y: eb.y + eb.height / 2 }, 10, 6); // 점선 테두리 둘레
  await win.keyboard.type('-11-16)');
  const q2 = await second();
  const focusKept = await win.evaluate(() => !!document.activeElement?.matches('.ann-text.editing > .ann-text-body'));
  pt = await at(590, 30);
  await win.mouse.click(pt.x, pt.y); // 빈 곳 클릭으로 입력 끝내기
  st = await state();
  const q3 = st.anns.filter((a) => a.type === 'text')[1];
  check('두 번째 글상자', st.anns.filter((a) => a.type === 'text').length === 2);
  check(
    '입력 중에 손잡이·테두리로 글상자 옮기기 (입력은 그대로 이어짐)',
    q3.text === '서명: 홍길동 (2026-11-16)' && near(q0, q1, 40, -20) && near(q1, q2, 10, 6) && near(q2, q3, 0, 0) && focusKept,
    `${JSON.stringify(q3.text)} (${q0.x.toFixed(1)}, ${q0.y.toFixed(1)}) → (${q1.x.toFixed(1)}, ${q1.y.toFixed(1)}) → (${q3.x.toFixed(1)}, ${q3.y.toFixed(1)}), focus=${focusKept}`,
  );
  // 실행 취소: 이어 쓴 글자 → 테두리로 옮기기 → 이어 쓴 글자 → 손잡이로 옮기기 순서로 하나씩 (같은 단계가 두 번 남지 않음)
  const undone = [];
  for (let i = 0; i < 4; i++) {
    await win.click('[data-cmd="undo"]');
    undone.push(await second());
  }
  for (let i = 0; i < 4; i++) await win.click('[data-cmd="redo"]');
  const redone = await second();
  check(
    '입력 중 옮기기: 실행 취소 단계 (글자·옮기기 따로)',
    undone[0].text === '서명: 홍길동 (2026' && near(q2, undone[0], 0, 0) &&
      undone[1].text === '서명: 홍길동 (2026' && near(q1, undone[1], 0, 0) &&
      undone[2].text === '서명: 홍길동' && near(q1, undone[2], 0, 0) &&
      undone[3].text === '서명: 홍길동' && near(q0, undone[3], 0, 0) &&
      JSON.stringify(redone) === JSON.stringify(q3),
    undone.map((a) => `${JSON.stringify(a.text)}@(${a.x.toFixed(1)}, ${a.y.toFixed(1)})`).join(' ← '),
  );
}

// ---------------------------------------------------------------------------
// 4. 형광펜
// ---------------------------------------------------------------------------
await win.click('[data-tool="highlight"]');
// 두 번째 줄 (pdf y=672 → 화면 위에서 792-672=120, 글자 크기 14 → 중심 ~115)
let a1 = await at(56, 115);
let a2 = await at(470, 115);
await win.mouse.move(a1.x, a1.y);
await win.mouse.down();
await win.mouse.move(a2.x, a2.y + 2, { steps: 25 });
await win.mouse.up();
// 초록색으로 세 번째 줄
await win.click('.opt-group:not([hidden]) .swatch[data-color="#7ff09b"]');
a1 = await at(56, 143);
a2 = await at(330, 143);
await win.mouse.move(a1.x, a1.y);
await win.mouse.down();
await win.mouse.move((a1.x + a2.x) / 2, a1.y - 3, { steps: 10 });
await win.mouse.move(a2.x, a2.y, { steps: 10 });
await win.mouse.up();
// 지울 획
a1 = await at(100, 230);
a2 = await at(300, 260);
await win.mouse.move(a1.x, a1.y);
await win.mouse.down();
await win.mouse.move(a2.x, a2.y, { steps: 12 });
await win.mouse.up();
st = await state();
check('형광펜 획 3개', st.anns.filter((a) => a.type === 'highlight').length === 3);

// 지우개로 세 번째 획 지우기
await win.click('[data-tool="eraser"]');
a1 = await at(200, 220);
a2 = await at(200, 270);
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
const target = await at(306, 392);
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
// 7-1b. 글꼴 추가 (TTF, TTC 에서 하나 고르기) — macOS 시스템 글꼴로 시험
// ---------------------------------------------------------------------------
const TTF = '/System/Library/Fonts/Supplemental/AppleMyungjo.ttf';
const TTC = '/System/Library/Fonts/AppleSDGothicNeo.ttc';
const fontTest = fs.existsSync(TTF) && fs.existsSync(TTC);
if (fontTest) {
  await win.click('[data-tool="text"]');
  await win.setInputFiles('#font-input', TTF);
  await win.waitForSelector('.toast-success:has-text("AppleMyungjo")');
  b5 = await page5.boundingBox();
  await win.mouse.click(b5.x + 60 * s5, b5.y + 470 * s5);
  await win.waitForSelector('.ann-text.editing');
  await win.keyboard.type('사용자 글꼴 AppleMyungjo 테스트');
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  await win.setInputFiles('#font-input', TTC);
  await win.waitForSelector('.face-list');
  const faceCount = await win.locator('.face-list label').count();
  await win.locator('.face-list label').nth(1).click();
  await win.click('.modal-wide button[type="submit"]');
  await win.waitForSelector('.toast-success:has-text("Apple SD Gothic Neo")');
  const boldBtn = win.locator('.opt-group:not([hidden]) .bold-btn');
  if (!(await boldBtn.evaluate((el) => el.classList.contains('active')))) await boldBtn.click(); // 굵은 파일이 없는 글꼴 → 합성 굵게
  await win.mouse.click(b5.x + 60 * s5, b5.y + 520 * s5);
  await win.waitForSelector('.ann-text.editing');
  await win.keyboard.type('글꼴 모음에서 고른 글꼴 굵게');
  await win.keyboard.press('Escape');
  const fontsJson = JSON.parse(fs.readFileSync(path.join(userData, 'fonts', 'fonts.json'), 'utf8'));
  const userTexts = (await state()).anns.filter((a) => a.type === 'text' && String(a.font).startsWith('user:'));
  const synth = await win.locator('.ann-text.selected').evaluate((el) => getComputedStyle(el).fontSynthesis);
  check(
    '글꼴 추가 (TTF, TTC 에서 고르기) + 저장해 두기',
    faceCount > 1 && userTexts.length === 2 && fontsJson.length === 2 && synth.includes('weight'),
    `faces=${faceCount}, saved=${fontsJson.map((f) => f.name).join(' / ')}, synthesis=${synth}`,
  );
  // 목록에서 지우기 (선택된 글상자의 글꼴) → 저장 파일에서도 빠짐, 글상자는 나눔고딕으로
  await win.click('.opt-group:not([hidden]) .font-select + .icon-btn');
  await win.waitForTimeout(300);
  const afterRemove = JSON.parse(fs.readFileSync(path.join(userData, 'fonts', 'fonts.json'), 'utf8'));
  check('추가한 글꼴 지우기', afterRemove.length === 1 && afterRemove[0].name.includes('AppleMyungjo'), afterRemove.map((f) => f.name).join(', '));
  await win.click('[data-tool="select"]');
}

// ---------------------------------------------------------------------------
// 7-2. 기존 글자 고치기 (1쪽의 원래 글줄)
// ---------------------------------------------------------------------------
await win.locator('.thumb[data-index="0"]').click();
await win.waitForTimeout(400);
box = await page1.boundingBox();
await win.click('[data-tool="edit"]');
const selectAllInEditor = () => win.evaluate(() => document.getSelection().selectAllChildren(document.activeElement));
// 2번째 줄 "이 줄 위에 형광펜을 칠합니다. The quick brown fox ..." (기준선 y=120)
pt = await at(110, 115);
await win.mouse.move(pt.x, pt.y);
await win.waitForTimeout(300);
await win.mouse.move(pt.x + 2, pt.y);
await win.waitForSelector('.run-hover');
await win.mouse.click(pt.x, pt.y);
await win.waitForSelector('.ann-text.replaced.editing');
const prefilled = await win.locator('.ann-text.replaced.editing .ann-text-body').textContent();
await selectAllInEditor();
await win.keyboard.type('고친 문장입니다 (Edited line)');
await win.keyboard.press('Escape');
// 1번째 줄은 지우기 (글자를 모두 지움)
pt = await at(110, 87);
await win.mouse.click(pt.x, pt.y);
await win.waitForSelector('.ann-text.replaced.editing');
await selectAllInEditor();
await win.keyboard.press('Backspace');
await win.keyboard.press('Escape');
st = await state();
const repl = st.anns.filter((a) => a.type === 'text' && a.cover);
check(
  '기존 글자 고치기 (원래 글자 채워짐 → 수정, 지우기)',
  prefilled.includes('The quick brown fox') && repl.length === 2 && repl.some((a) => a.text === '고친 문장입니다 (Edited line)') && repl.some((a) => a.text === ''),
  `prefilled=${JSON.stringify(prefilled.slice(0, 30))} → ${repl.map((a) => JSON.stringify(a.text)).join(', ')}`,
);
await win.click('[data-tool="select"]');

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
{
  const savedToast = win.locator('.toast-success', { hasText: '저장했습니다' }).first();
  await savedToast.locator('.toast-close').click();
  await win.waitForTimeout(400);
  check('알림 닫기 단추', (await win.locator('.toast-success', { hasText: '저장했습니다' }).count()) === 0);
}

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
check('고친 글자: 원래 글자는 지워지고 새 글자만', !text.includes('The quick brown fox') && !text.includes('첫 번째 페이지') && text.includes('고친 문장입니다 (Edited line)'));
if (fontTest) {
  const fontsList = execFileSync('pdffonts', [pdfPath]).toString();
  check('추가한 글꼴이 PDF에 들어감', /AppleMyungjo/.test(fontsList) && text.includes('사용자 글꼴 AppleMyungjo 테스트') && text.includes('글꼴 모음에서 고른 글꼴 굵게'));
}
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

// ---------------------------------------------------------------------------
// 10-1. 이미지로 내보내기: 고른 페이지 → ZIP, 전체 → 폴더(JPG), 직접 지정 → 한 장, 취소
// ---------------------------------------------------------------------------
{
  const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
  const jpgSize = (buf) => {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  };
  const sizes = await win.evaluate(() => {
    const s = window.__godseon.store;
    return s.doc.pages.filter((p) => !s.deleted.has(p.index)).map((p) => ({ w: p.width, h: p.height }));
  });
  const expect = (i, dpi) => ({ w: Math.round((sizes[i].w * dpi) / 72), h: Math.round((sizes[i].h * dpi) / 72) });
  const same = (a, b) => !!a && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;
  const modal = '.export-modal';
  const pick = (name, value) => win.click(`${modal} label:has(> input[name="${name}"][value="${value}"])`);
  const pyZip = `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
z.extractall(sys.argv[2])
print(json.dumps({"bad": bad, "names": z.namelist()}))
`;

  // (1) 페이지 목록에서 1~3쪽을 고르고(클릭 + Shift 클릭) PNG 72dpi → ZIP
  await win.locator('.thumb[data-index="0"]').click();
  await win.locator('.thumb[data-index="2"]').click({ modifiers: ['Shift'] });
  await win.click('[data-cmd="exportImages"]');
  await win.waitForSelector(modal);
  const scopeText = (await win.locator(`${modal} input[name="scope"]:checked`).evaluate((el) => el.closest('label').textContent)).replace(/\s+/g, ' ').trim();
  check('이미지 내보내기 창: 고른 페이지가 기본으로 선택됨', scopeText.includes('선택한 페이지') && scopeText.includes('3장 (1–3쪽)'), scopeText);
  await pick('format', 'png');
  await pick('dpi', '72');
  await pick('output', 'zip');
  await win.screenshot({ path: path.join(out, '09-export-dialog.png') });
  await win.click(`${modal} button[type="submit"]`);
  await win.waitForSelector('.toast-success:has-text("ZIP")', { timeout: 30000 });
  const zipFile = path.join(exportDir, 'fixture_images.zip');
  const unzipped = path.join(out, 'export-unzipped');
  const z = JSON.parse(execFileSync('python3', ['-c', pyZip, zipFile, unzipped]).toString());
  const zipSizes = z.names.map((n) => pngSize(fs.readFileSync(path.join(unzipped, n))));
  check(
    '고른 페이지 → ZIP (이름·개수·CRC·크기)',
    z.bad === null &&
      JSON.stringify(z.names) === JSON.stringify(['fixture_p01.png', 'fixture_p02.png', 'fixture_p03.png']) &&
      zipSizes.every((sz, i) => same(sz, expect(i, 72))),
    `${z.names.join(', ')} · ${zipSizes.map((sz) => `${sz.w}×${sz.h}`).join(', ')}`,
  );

  // (2) 메뉴(파일 › 이미지로 내보내기…)에서 전체 페이지 JPG 150dpi → 폴더
  await app.evaluate(({ Menu }) => {
    const find = (items) => {
      for (const it of items) {
        if (it.label === '이미지로 내보내기…') return it;
        const r = it.submenu && find(it.submenu.items);
        if (r) return r;
      }
      return null;
    };
    find(Menu.getApplicationMenu().items).click();
  });
  await win.waitForSelector(modal);
  await pick('scope', 'all');
  await pick('format', 'jpg');
  await pick('dpi', '150');
  await pick('output', 'folder');
  await win.click(`${modal} button[type="submit"]`);
  await win.waitForSelector('.toast-success:has-text("폴더")', { timeout: 30000 });
  const folder = path.join(exportDir, 'fixture_images');
  const jpgs = fs.existsSync(folder) ? fs.readdirSync(folder).sort() : [];
  const jpgSizes = jpgs.map((n) => jpgSize(fs.readFileSync(path.join(folder, n))));
  check(
    '전체 페이지 → 폴더에 JPG 낱장 (메뉴에서)',
    JSON.stringify(jpgs) === JSON.stringify(['fixture_p01.jpg', 'fixture_p02.jpg', 'fixture_p03.jpg', 'fixture_p04.jpg']) &&
      jpgSizes.every((sz, i) => same(sz, expect(i, 150))),
    `${jpgs.join(', ')} · ${jpgSizes.map((sz) => (sz ? `${sz.w}×${sz.h}` : '?')).join(', ')}`,
  );

  // (3) 직접 지정: 잘못된 번호는 막고, "4" → 이미지 한 장
  await win.click('[data-cmd="exportImages"]');
  await win.waitForSelector(modal);
  await win.fill(`${modal} .range-input`, '9');
  const blocked = await win.locator(`${modal} button[type="submit"]`).isDisabled();
  const errText = await win.locator(`${modal} [data-summary]`).textContent();
  await win.fill(`${modal} .range-input`, '4');
  const outputHidden = await win.locator(`${modal} [data-output]`).isHidden();
  await pick('format', 'png');
  await pick('dpi', '150');
  await win.click(`${modal} button[type="submit"]`);
  await win.waitForSelector('.toast-success:has-text("fixture_p04.png")', { timeout: 30000 });
  const single = path.join(exportDir, 'fixture_p04.png');
  const singleSize = fs.existsSync(single) ? pngSize(fs.readFileSync(single)) : null;
  check(
    '직접 지정 → 한 장 (잘못된 번호는 막음)',
    blocked && errText.includes('1–4') && outputHidden && same(singleSize, expect(3, 150)),
    `${errText} · ${singleSize ? `${singleSize.w}×${singleSize.h}` : 'missing'}`,
  );

  // (4) 진행 중 취소: 전체 → ZIP 을 시작하자마자 취소 → 앞서 만든 ZIP 은 그대로, 임시 파일 없음
  //     (테스트 문서는 금방 끝나므로 이 단계에서만 이미지 만들기를 한 장에 0.7초씩 늦춘다)
  const before = fs.readFileSync(zipFile);
  await win.evaluate(() => {
    const orig = HTMLCanvasElement.prototype.toBlob;
    window.__restoreToBlob = () => (HTMLCanvasElement.prototype.toBlob = orig);
    HTMLCanvasElement.prototype.toBlob = function (cb, ...args) {
      setTimeout(() => orig.call(this, cb, ...args), 700);
    };
  });
  await win.click('[data-cmd="exportImages"]');
  await win.waitForSelector(modal);
  await pick('scope', 'all');
  await pick('dpi', '300');
  await pick('output', 'zip');
  await win.click(`${modal} button[type="submit"]`);
  await win.click('#busy-cancel', { timeout: 10000 });
  await win.waitForSelector('.toast:has-text("취소했습니다")', { timeout: 30000 });
  await win.waitForTimeout(300);
  await win.evaluate(() => window.__restoreToBlob());
  const leftovers = fs.readdirSync(exportDir).filter((n) => n.endsWith('.part'));
  check('내보내기 취소 → 기존 파일 유지, 임시 파일 없음', before.equals(fs.readFileSync(zipFile)) && leftovers.length === 0, leftovers.join(', '));

  // 다음 단계를 위해 고른 페이지를 비운다
  await win.click('[data-tool="select"]');
}

// ---------------------------------------------------------------------------
// 10-2. 서명: 서랍 → 그리기(되돌리기) → 저장하고 넣기 → 끌어다 놓기 → 눌러서 넣기 → 지우기/되살리기 → 저장
// ---------------------------------------------------------------------------
{
  const sigDir = path.join(userData, 'signatures');
  const imageAnns = async () => (await state()).anns.filter((a) => a.type === 'image');
  const before = (await imageAnns()).length;
  await win.click('#sig-toggle');
  await win.waitForSelector('#app.drawer-open .sig-empty');
  check('서명 서랍 열기 (처음엔 비어 있음)', (await win.locator('#sig-toggle').getAttribute('aria-pressed')) === 'true');

  // 서명 그리기 (좌표는 서명 칸 단위 600×220)
  await win.click('[data-cmd="newSignature"]');
  await win.waitForSelector('.sig-modal canvas');
  const box = await win.locator('.sig-modal canvas').boundingBox();
  const at = (u, v) => [box.x + (u * box.width) / 600, box.y + (v * box.height) / 220];
  const stroke = async (pts) => {
    await win.mouse.move(...at(...pts[0]));
    await win.mouse.down();
    for (const p of pts.slice(1)) await win.mouse.move(...at(...p), { steps: 2 });
    await win.mouse.up();
  };
  const wave = Array.from({ length: 41 }, (_, i) => [100 + i * 5, 110 + Math.sin(i / 3) * 30]);
  await stroke(wave); // 가로 100~300, 세로 80~140
  await stroke([[320, 90], [370, 130], [420, 95]]);
  await stroke([[100, 185], [330, 190], [560, 185]]); // 되돌리기 단추로 지울 획
  await win.click('.sig-modal [data-act="undo"]');
  await stroke([[200, 40], [260, 40]]); // ⌘/Ctrl+Z 로 지울 획
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await win.screenshot({ path: path.join(out, '10-signature-pad.png') });
  await win.click('.sig-modal [data-act="insert"]');
  await win.waitForSelector('.sig-card');
  const afterInsert = await imageAnns();
  const first = afterInsert[afterInsert.length - 1];
  const png = await win.evaluate(async (imageId) => {
    const asset = window.__godseon.store.images.get(imageId);
    const bmp = await createImageBitmap(new Blob([asset.bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let inked = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 200) inked++;
    return { w: c.width, h: c.height, corner: d[3], inked, kind: asset.kind };
  }, first.imageId);
  const fits = Math.max(first.w / 140, first.h / 50);
  check(
    '서명 만들기 → 여백 잘라 투명 PNG, 되돌리기(단추·⌘Z) 반영, 페이지에 넣기',
    afterInsert.length === before + 1 &&
      png.kind === 'png' && png.corner === 0 && png.inked > 500 &&
      png.w > 900 && png.w < 1100 && png.h > 150 && png.h < 260 &&
      Math.abs(fits - 1) < 0.01,
    `${png.w}×${png.h}px, 넣은 크기 ${first.w.toFixed(1)}×${first.h.toFixed(1)}pt`,
  );
  const files = () => (fs.existsSync(sigDir) ? fs.readdirSync(sigDir).filter((f) => f.endsWith('.png')) : []);
  check('서명이 서랍(사용자 폴더)에 저장됨', files().length === 1 && (await win.locator('.sig-card').count()) === 1);

  // 서랍에서 1쪽으로 끌어다 놓기 → 놓은 자리가 서명의 가운데
  const pageEl = win.locator('.page[data-index="0"]');
  await pageEl.scrollIntoViewIfNeeded();
  const pb = await pageEl.boundingBox();
  const target = { x: pb.width * 0.5, y: Math.min(pb.height * 0.8, 600) };
  await win.locator('.sig-card').first().dragTo(pageEl, { targetPosition: target });
  await win.waitForTimeout(300);
  const afterDrop = await imageAnns();
  const dropped = afterDrop[afterDrop.length - 1];
  const info0 = await win.evaluate(() => window.__godseon.store.doc.pages[0].width);
  const k = info0 / pb.width; // 화면 px → 페이지 단위
  const dx = Math.abs(dropped.x + dropped.w / 2 - target.x * k);
  const dy = Math.abs(dropped.y + dropped.h / 2 - target.y * k);
  check(
    '서명 끌어다 놓기 (놓은 자리에 들어감)',
    afterDrop.length === before + 2 && dropped.page === 0 && dx < 2 && dy < 2,
    `Δ${dx.toFixed(2)}, ${dy.toFixed(2)}pt`,
  );

  // 눌러서 넣기 → 같은 이미지를 같이 쓴다
  await win.locator('.sig-card').first().click();
  await win.waitForTimeout(200);
  const afterClick = await imageAnns();
  const sigAnns = afterClick.slice(before);
  check('서명 눌러서 넣기 (같은 이미지 재사용)', sigAnns.length === 3 && new Set(sigAnns.map((a) => a.imageId)).size === 1);

  // 서랍에서 지우기 → 알림의 실행 취소로 되살리기
  await win.locator('.sig-card').first().hover();
  await win.click('.sig-card .sig-del');
  await win.waitForSelector('.sig-empty');
  const removedFiles = files().length;
  await win.locator('.toast', { hasText: '서명을 서랍에서 지웠습니다' }).locator('.toast-action').click();
  await win.waitForSelector('.sig-card');
  const listed = await win.evaluate(async () => (await window.godseon.listSignatures()).map((x) => x.data.byteLength));
  check('서랍에서 지우기 → 실행 취소로 되살리기', removedFiles === 0 && files().length === 1 && listed.length === 1 && listed[0] > 0, `listed=${listed}`);
  await win.screenshot({ path: path.join(out, '11-signature-placed.png') });

  // 저장 → PDF 에 서명이 투명도(SMask)와 함께 한 번만 들어가고 세 곳에 그려짐
  await win.click('[data-cmd="save"]');
  await win.waitForFunction(() => !window.__godseon.history.dirty, null, { timeout: 20000 });
  const rows = execFileSync('pdfimages', ['-list', pdfPath])
    .toString()
    .split('\n')
    .slice(2)
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c.length > 11 && Number(c[3]) === png.w && Number(c[4]) === png.h);
  const imgRows = rows.filter((c) => c[2] === 'image');
  const maskRows = rows.filter((c) => c[2] === 'smask');
  check(
    '저장된 PDF에 서명 (투명 마스크, 이미지 하나를 세 번 사용)',
    imgRows.length === 3 && maskRows.length === 3 && new Set(imgRows.map((c) => c[10])).size === 1,
    `image=${imgRows.length} smask=${maskRows.length} objects=${[...new Set(imgRows.map((c) => c[10]))]}`,
  );
  await win.click('#sig-toggle');
}

// ---------------------------------------------------------------------------
// 11. 언어 바꾸기 (한국어 ↔ English): 화면·메뉴가 바뀌고 열린 문서는 그대로
// ---------------------------------------------------------------------------
const annsBefore = (await state()).anns.length;
await win.click('[data-cmd="toggleLanguage"]');
await win.waitForTimeout(400);
const openLabel = await win.locator('[data-cmd="open"] span').first().textContent();
const toolLabel = await win.locator('[data-tool="table"] span').textContent();
const menuLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label));
await win.screenshot({ path: path.join(out, '08-english.png') });
const annsAfter = (await state()).anns.length;
check(
  '언어 바꾸기 → English (화면·메뉴, 문서 유지)',
  openLabel === 'Open' && toolLabel === 'Table' && menuLabels.includes('File') && menuLabels.includes('Tools') && annsAfter === annsBefore,
  `${openLabel} / ${toolLabel} / ${menuLabels.join(',')}`,
);
await win.click('[data-cmd="toggleLanguage"]');
await win.waitForTimeout(300);
check('다시 한국어', (await win.locator('[data-cmd="open"] span').first().textContent()) === '열기');

check('렌더러 콘솔 오류 없음', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

// 저장하지 않은 변경이 남아 있어도 묻지 않고 끝낸다 (테스트가 확인 창에서 멈추지 않도록)
await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
await app.close().catch(() => {});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. 결과물: ${path.relative(root, out)}/`);
process.exit(failed.length ? 1 : 0);
