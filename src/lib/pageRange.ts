// 페이지 번호 목록 읽기·보여 주기 (이미지로 내보내기 대화상자)

/** "1-3, 5, 8~10", "5-"(끝까지), "-3"(처음부터) → 페이지 번호 목록. 잘못되었으면 null */
export function parsePageRange(text: string, total: number): number[] | null {
  const parts = text
    .replace(/\s*[-–~∼]\s*/g, '-')
    .split(/[,，、;\s]+/)
    .filter(Boolean);
  if (!parts.length) return null;
  const out = new Set<number>();
  for (const part of parts) {
    const m = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3]) || (!m[2] && m[3])) return null;
    let a = m[1] ? Number(m[1]) : 1;
    let b = m[2] ? (m[3] ? Number(m[3]) : total) : a;
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > total) return null;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

/** [1,2,3,5,8,9,10] → "1–3, 5, 8–10" (길면 줄인다) */
export function formatPages(pages: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(j > i ? `${pages[i]}–${pages[j]}` : String(pages[i]));
    i = j + 1;
  }
  let s = '';
  for (const p of parts) {
    const next = s ? `${s}, ${p}` : p;
    if (next.length > 32 && s) return `${s}, …`;
    s = next;
  }
  return s;
}
