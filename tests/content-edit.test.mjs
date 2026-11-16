// 원래 글자 지우기(src/lib/contentEdit.ts) 단위 테스트. poppler 의 pdftotext 가 필요하다.
//   node --test tests/content-edit.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fontkit from '@cantoo/fontkit';
import { beginText, endText, moveText, PDFDocument, setFontAndSize, showText, StandardFonts } from '@cantoo/pdf-lib';
import { removeTextInRects } from '../src/lib/contentEdit.ts';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'godseon-ce-'));

/** pdftotext -bbox 로 단어와 위치 */
function words(bytes) {
  const file = path.join(tmp, `w${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, bytes);
  const xml = execFileSync('pdftotext', ['-bbox', file, '-']).toString();
  return [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({
    text: m[5],
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

const rectFor = (x, baseline, width, size) => ({ x0: x, y0: baseline - size * 0.25, x1: x + width, y1: baseline + size * 0.9 });

async function reload(doc) {
  return PDFDocument.load(await doc.save());
}

test('CID(Identity-H) 글꼴: 가운데 줄만 지우고 나머지는 그대로', async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(path.join(root, 'public/fonts/NanumGothic-Regular.ttf')), { subset: true });
  const page = doc.addPage([400, 300]);
  page.drawText('첫번째 줄입니다', { x: 40, y: 250, size: 14, font });
  page.drawText('두번째 줄입니다', { x: 40, y: 220, size: 14, font });
  page.drawText('세번째 줄입니다', { x: 40, y: 190, size: 14, font });
  const loaded = await reload(doc);
  const before = words(await loaded.save());
  const w = font.widthOfTextAtSize('두번째 줄입니다', 14);
  const res = removeTextInRects(loaded, loaded.getPage(0), [rectFor(40, 220, w, 14)]);
  assert.deepEqual(res.ok, [true]);
  assert.ok(res.removed >= 1);
  const after = words(await loaded.save());
  const texts = after.map((x) => x.text).join(' ');
  assert.ok(!texts.includes('두번째'), texts);
  assert.ok(texts.includes('첫번째') && texts.includes('세번째'), texts);
  const third = (list) => list.find((x) => x.text === '세번째');
  assert.equal(third(after).x, third(before).x);
});

test('표준 글꼴(Helvetica, 폭 표 없음): 앞 조각을 지워도 뒤 글자 위치가 그대로', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText('keep', { x: 40, y: 260, size: 12, font }); // 글꼴을 페이지 자원에 등록
  const key = page.node.newFontDictionary('F', font.ref);
  page.pushOperators(
    beginText(),
    setFontAndSize(key, 12),
    moveText(40, 200),
    showText(font.encodeText('Hello')),
    showText(font.encodeText(' World')),
    endText(),
  );
  const loaded = await reload(doc);
  const before = words(await loaded.save());
  const w = font.widthOfTextAtSize('Hello', 12);
  const res = removeTextInRects(loaded, loaded.getPage(0), [rectFor(40, 200, w, 12)]);
  assert.deepEqual(res.ok, [true]);
  const after = words(await loaded.save());
  const texts = after.map((x) => x.text);
  assert.ok(!texts.includes('Hello'), texts.join(' '));
  assert.ok(texts.includes('World') && texts.includes('keep'), texts.join(' '));
  const world = (list) => list.find((x) => x.text === 'World');
  assert.ok(Math.abs(world(after).x - world(before).x) < 0.01, `${world(before).x} → ${world(after).x}`);
});

test('사각형에 일부만 걸친 글자는 지우지 않는다 (전부 아니면 전무)', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText('Partially covered text', { x: 40, y: 200, size: 12, font });
  const loaded = await reload(doc);
  const w = font.widthOfTextAtSize('Partially', 12);
  const res = removeTextInRects(loaded, loaded.getPage(0), [rectFor(40, 200, w, 12)]);
  assert.deepEqual(res.ok, [false]);
  assert.equal(res.removed, 0);
  const texts = words(await loaded.save()).map((x) => x.text).join(' ');
  assert.equal(texts, 'Partially covered text');
});

test('글자가 없는 곳은 ok=false (덮개로만 처리)', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
  const loaded = await reload(doc);
  const res = removeTextInRects(loaded, loaded.getPage(0), [{ x0: 100, y0: 100, x1: 200, y1: 120 }]);
  assert.deepEqual(res.ok, [false]);
});
