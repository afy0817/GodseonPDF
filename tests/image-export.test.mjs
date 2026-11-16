// 이미지로 내보내기 부품 단위 테스트: ZIP 작성기(src/lib/zip.ts), 페이지 범위(src/lib/pageRange.ts).
// ZIP 은 파이썬 zipfile 로 읽어 이름(UTF-8)·CRC·내용을 확인한다.
//   node --test tests/image-export.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { formatPages, parsePageRange } from '../src/lib/pageRange.ts';
import { crc32, ZipWriter } from '../src/lib/zip.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'godseon-zip-'));

test('crc32 는 zlib 과 같다', () => {
  for (const data of [new Uint8Array(0), new TextEncoder().encode('갓선 PDF'), crypto.randomBytes(100_000)]) {
    assert.equal(crc32(data), zlib.crc32(data));
  }
});

test('ZIP: 한글 이름·이진 데이터를 그대로 담고, 다른 프로그램이 읽을 수 있다', async () => {
  const files = [
    ['개인정보_동의서_p01.png', crypto.randomBytes(70_000)],
    ['개인정보_동의서_p02.png', crypto.randomBytes(1)],
    ['empty.jpg', new Uint8Array(0)],
    ['영문 & space (1).jpg', crypto.randomBytes(5000)],
  ];
  const chunks = [];
  let calls = 0;
  const zip = new ZipWriter(async (c) => {
    calls += 1;
    chunks.push(...c.map((x) => Buffer.from(x)));
  });
  for (const [name, data] of files) await zip.add(name, new Uint8Array(data), new Date(2026, 10, 16, 9, 30, 12));
  await zip.finish();
  assert.equal(calls, files.length + 1, '항목마다 바로 내보낸다');

  const file = path.join(tmp, 'out.zip');
  fs.writeFileSync(file, Buffer.concat(chunks));
  const py = `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
print(json.dumps({"bad": bad, "items": [[i.filename, i.file_size, i.flag_bits, i.compress_type, list(i.date_time)] for i in z.infolist()]}))
`;
  const info = JSON.parse(execFileSync('python3', ['-c', py, file]).toString());
  assert.equal(info.bad, null, 'CRC 오류 없음');
  assert.deepEqual(
    info.items.map((i) => i[0]),
    files.map((f) => f[0]),
  );
  for (const [i, item] of info.items.entries()) {
    assert.equal(item[1], files[i][1].length);
    assert.ok(item[2] & 0x800, 'UTF-8 이름 표시');
    assert.equal(item[3], 0, '압축 없이 저장');
    assert.deepEqual(item[4], [2026, 11, 16, 9, 30, 12]);
  }
  const extracted = execFileSync('python3', ['-c', 'import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))', file, files[0][0]]);
  assert.ok(extracted.equals(files[0][1]), '내용이 같다');
});

test('ZIP: 같은 이름은 거부', async () => {
  const zip = new ZipWriter(async () => {});
  await zip.add('a.png', new Uint8Array(3));
  await assert.rejects(() => zip.add('a.png', new Uint8Array(3)));
});

test('페이지 범위 읽기', () => {
  assert.deepEqual(parsePageRange('1-3, 5', 10), [1, 2, 3, 5]);
  assert.deepEqual(parsePageRange(' 3 ~ 1 ,5 5', 10), [1, 2, 3, 5]);
  assert.deepEqual(parsePageRange('8-', 10), [8, 9, 10]);
  assert.deepEqual(parsePageRange('-2', 10), [1, 2]);
  assert.deepEqual(parsePageRange('2–4、7', 10), [2, 3, 4, 7]);
  for (const bad of ['', ' ', '0', '11', '1-11', '-', 'a', '1-2-3', '1.5']) assert.equal(parsePageRange(bad, 10), null, JSON.stringify(bad));
});

test('페이지 목록 보여 주기', () => {
  assert.equal(formatPages([1, 2, 3, 5, 8, 9, 10]), '1–3, 5, 8–10');
  assert.equal(formatPages([4]), '4');
  const long = formatPages(Array.from({ length: 40 }, (_, i) => i * 2 + 1));
  assert.ok(long.endsWith(', …') && long.length <= 40, long);
});
