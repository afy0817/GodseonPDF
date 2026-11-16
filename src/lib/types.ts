export type Tool = 'select' | 'text' | 'highlight' | 'eraser' | 'table';

/**
 * 모든 좌표는 "페이지 단위"(= 100% 배율에서 화면에 보이는 방향 기준의 PDF 포인트)이며,
 * 원점은 페이지 왼쪽 위, y 는 아래로 증가한다. 회전된 페이지도 화면에 보이는 그대로의 좌표를 쓴다.
 */
export interface TextAnnotation {
  id: string;
  type: 'text';
  page: number; // 원본 PDF에서의 페이지 인덱스 (0부터)
  x: number; // 글상자 왼쪽 위
  y: number;
  text: string;
  size: number; // 글자 크기 (pt)
  color: string; // #rrggbb
  bold: boolean;
}

export interface ImageAnnotation {
  id: string;
  type: 'image';
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  imageId: string;
}

export interface HighlightAnnotation {
  id: string;
  type: 'highlight';
  page: number;
  points: number[]; // [x0, y0, x1, y1, ...]
  color: string;
  width: number;
  opacity: number;
}

/** 표: 열 너비·행 최소 높이·칸 글자. 칸 글자는 자동 줄바꿈되고, 행 높이는 내용에 맞춰 늘어난다. */
export interface TableAnnotation {
  id: string;
  type: 'table';
  page: number;
  x: number; // 왼쪽 위
  y: number;
  cols: number[]; // 열 너비 (pt)
  rows: number[]; // 행 최소 높이 (pt)
  cells: string[][]; // [행][열]
  size: number; // 글자 크기 (pt)
  color: string; // 글자 색
  border: string; // 선 색
  align: 'left' | 'center';
  header: boolean; // 첫 행을 머리글로 (배경색 + 굵게)
}

export type Annotation = TextAnnotation | ImageAnnotation | HighlightAnnotation | TableAnnotation;

export interface ImageAsset {
  id: string;
  bytes: Uint8Array;
  kind: 'png' | 'jpg';
  width: number; // 픽셀
  height: number;
  url: string; // 화면 표시용 object URL
}

export interface PageInfo {
  index: number;
  width: number; // 배율 1 기준 화면 크기 (회전 반영)
  height: number;
  /** pdf.js viewport(배율 1) 변환 행렬: PDF 사용자 좌표 → 페이지 단위 좌표 */
  transform: number[];
}

export interface OpenedFile {
  name: string;
  path: string | null;
  data: Uint8Array;
}

export interface SaveResult {
  name: string;
  path: string | null;
}
