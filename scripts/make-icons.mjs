/**
 * 아이콘 PNG 생성 (외부 이미지 도구 없이 zlib으로 직접 인코딩)
 * - build/icons/icon.png      256px 앱 아이콘 (설치 파일·작업표시줄)
 * - build/icons/icon.ico      256·48·32·16px (개발 실행 바로가기 아이콘)
 * - build/icons/tray.png      32px 트레이 아이콘
 * - build/icons/tray-unread.png 32px 트레이 아이콘 + 안 읽음 점
 * - build/icons/overlay-1.png … overlay-9.png, overlay-9plus.png  32px 작업표시줄 안 읽음 숫자 (빨간 원)
 * - build/installer/sidebar.bmp 164x314 설치 화면 시작·마침 페이지 왼쪽 그림
 * - build/installer/header.bmp  150x57 설치 진행 페이지 머리 그림
 *
 * 디자인: 살짝 둥근 브랜드 빨강(#e8261a) 정사각형, 가운데 굵은 흰 V (끝이 평평한 기하 도형)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BUILD = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "build");
const OUT = path.join(BUILD, "icons");
const INSTALLER_OUT = path.join(BUILD, "installer");
const BRAND = [0xe8, 0x26, 0x1a];
const WHITE = [0xff, 0xff, 0xff];
const DOT = [0xff, 0x55, 0x4f];
const BRAND_DARK = [0xb8, 0x1c, 0x12];
const SUPERSAMPLE = 4;

function crc32(buf) {
  let c;
  const table = crc32.table ??= Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 0..1 좌표계 도형
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** 점이 다각형 안인지 (짝홀 규칙) */
function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 굵은 V (위 끝은 평평, 아래는 좁게 모인다). 가운데 정렬 */
const V_SHAPE = [
  [0.255, 0.28],
  [0.39, 0.28],
  [0.5, 0.575],
  [0.61, 0.28],
  [0.745, 0.28],
  [0.567, 0.735],
  [0.433, 0.735],
];

/** 둥근 정사각형과 그 안의 V (0..1 좌표). "v" | "tile" | null */
function tileMark(x, y) {
  if (!inRoundRect(x, y, 0.03, 0.03, 0.97, 0.97, 0.19)) return null;
  return inPolygon(x, y, V_SHAPE) ? "v" : "tile";
}

/** 픽셀 색 결정 (위에서부터 덮어쓴다). null이면 투명 */
function appIconColor(x, y, withDot) {
  // 안 읽음 점: 빨간 바탕 위라 흰 테두리로 구분
  if (withDot && inCircle(x, y, 0.82, 0.18, 0.17)) return DOT;
  if (withDot && inCircle(x, y, 0.82, 0.18, 0.24)) return WHITE;
  const mark = tileMark(x, y);
  if (mark === "v") return WHITE;
  if (mark === "tile") return BRAND;
  return null;
}

/** 작업표시줄 숫자용 3x5 픽셀 글꼴 (16px로 줄어도 또렷하게) */
const GLYPHS = {
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "001", "010", "010"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};

/** 글자들을 가운데 놓았을 때 (x, y)가 글자 칸 안인지. unit = 한 칸 크기 (0..1 좌표) */
function inText(x, y, text, unit) {
  const width = text.length * 3 + (text.length - 1);
  const left = 0.5 - (width * unit) / 2;
  const top = 0.5 - (5 * unit) / 2;
  const col = Math.floor((x - left) / unit);
  const row = Math.floor((y - top) / unit);
  if (row < 0 || row >= 5 || col < 0 || col >= width) return false;
  const index = Math.floor(col / 4);
  const inner = col % 4;
  return inner < 3 && GLYPHS[text[index]][row][inner] === "1";
}

/** 빨간 원(흰 테두리) 안에 흰 숫자 */
function overlayNumberColor(text) {
  const unit = text.length === 1 ? 0.12 : 0.085;
  return (x, y) => {
    if (inCircle(x, y, 0.5, 0.5, 0.44)) return inText(x, y, text, unit) ? WHITE : DOT;
    if (inCircle(x, y, 0.5, 0.5, 0.5)) return WHITE;
    return null;
  };
}

function render(size, colorAt) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const color = colorAt((px + (sx + 0.5) / SUPERSAMPLE) / size, (py + (sy + 0.5) / SUPERSAMPLE) / size);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
        rgba[i + 3] = Math.round((a / SUPERSAMPLE ** 2) * 255);
      }
    }
  }
  return encodePng(size, rgba);
}

/** ICO (PNG를 그대로 담는 형식, Windows Vista+) */
function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([size, png], i) => {
    const entry = 6 + i * 16;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(([, png]) => png)]);
}

/** 24비트 BMP (NSIS 설치 화면 그림은 BMP만 받는다). colorAt은 픽셀 좌표를 받아 불투명 색을 돌려준다 */
function renderBmp(width, height, colorAt) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const color = colorAt(px + (sx + 0.5) / SUPERSAMPLE, py + (sy + 0.5) / SUPERSAMPLE);
          for (let c = 0; c < 3; c++) sum[c] += color[c];
        }
      }
      // BMP는 아래 줄부터, BGR 순서
      const i = (height - 1 - py) * rowSize + px * 3;
      pixels[i] = Math.round(sum[2] / SUPERSAMPLE ** 2);
      pixels[i + 1] = Math.round(sum[1] / SUPERSAMPLE ** 2);
      pixels[i + 2] = Math.round(sum[0] / SUPERSAMPLE ** 2);
    }
  }
  const header = Buffer.alloc(54);
  header.write("BM", 0);
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  header.writeInt32LE(2835, 38);
  header.writeInt32LE(2835, 42);
  return Buffer.concat([header, pixels]);
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

/** 앱 아이콘을 (left, top)에 size 크기로 놓고, 바깥은 background(x, y) 색 */
function withIcon(left, top, size, background) {
  return (x, y) => appIconColor((x - left) / size, (y - top) / size, false) ?? background(x, y);
}

/** 시작·마침 페이지 왼쪽: 브랜드 빨강 세로 그라데이션 위 흰 타일에 빨간 V (빨간 배경에서는 색을 뒤집는다) */
function sidebarColor(x, y) {
  const background = mix(BRAND, BRAND_DARK, y / 314);
  const mark = tileMark((x - 32) / 100, (y - 80) / 100);
  return mark === "tile" ? WHITE : background;
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(INSTALLER_OUT, { recursive: true });
fs.writeFileSync(path.join(INSTALLER_OUT, "sidebar.bmp"), renderBmp(164, 314, sidebarColor));
fs.writeFileSync(path.join(INSTALLER_OUT, "header.bmp"), renderBmp(150, 57, withIcon(97, 8, 41, () => WHITE)));
fs.writeFileSync(path.join(OUT, "icon.png"), render(256, (x, y) => appIconColor(x, y, false)));
fs.writeFileSync(path.join(OUT, "icon.ico"), encodeIco([256, 48, 32, 16].map((size) => [size, render(size, (x, y) => appIconColor(x, y, false))])));
fs.writeFileSync(path.join(OUT, "tray.png"), render(32, (x, y) => appIconColor(x, y, false)));
fs.writeFileSync(path.join(OUT, "tray-unread.png"), render(32, (x, y) => appIconColor(x, y, true)));
for (let n = 1; n <= 9; n++) {
  fs.writeFileSync(path.join(OUT, `overlay-${n}.png`), render(32, overlayNumberColor(String(n))));
}
fs.writeFileSync(path.join(OUT, "overlay-9plus.png"), render(32, overlayNumberColor("9+")));
console.log(`아이콘 생성: ${OUT}`);
