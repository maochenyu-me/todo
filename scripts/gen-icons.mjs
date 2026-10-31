#!/usr/bin/env node
/**
 * 程序化生成 PWA 图标（无任何图像依赖，纯 Node：手写 PNG 编码器）。
 *
 * 为什么不用 sharp/canvas：图标只有三张、几何图形极简（纸色底 + 印章红方框 + 红勾），
 * 用「符号距离函数」逐像素采样几十毫秒就算完，不值得为它引入一个几十 MB 的原生依赖。
 *
 * 设计（与站点视觉同源，颜色取自 `global.css` 的令牌）：
 * - 纸色底 `#f6f3ea`（--background light）
 * - 印章红描边方框 + 同色对勾（--seal `#BE3A2B`）——「待办划掉」的印章意象
 * - maskable 变体：整幅出血纸色，图形收进中央 80% 安全区（Chrome 圆形裁切不切到内容）
 *
 * 产物提交进 `public/icons/`（构建链不重跑本脚本；改了设计才需要 `node scripts/gen-icons.mjs`）。
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'icons');

/** 站点视觉令牌（与 src/styles/global.css 同步，改动时两边一起改） */
const PAPER = [0xf6, 0xf3, 0xea, 0xff]; // --background (light)
const SEAL = [0xbe, 0x3a, 0x2b, 0xff]; // --seal (light)

/** 线宽相对画布边长的比例 */
const FRAME_RATIO = 0.055;
const CHECK_RATIO = 0.085;

/**
 * 极简 PNG 编码器：RGBA8、无滤镜、单 IDAT。几十 KB 的图不值得引依赖。
 */
function encodePng(width, height, rgba) {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 每行前置 filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 点到线段的最短距离（用于圆头描边的距离场采样） */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

/** 圆角矩形边框的距离场（≤ r 表示在线上；负数在外/内需分别处理） */
function distToRoundRectFrame(px, py, x0, y0, x1, y1, radius) {
  const cx = Math.max(x0 + radius, Math.min(px, x1 - radius));
  const cy = Math.max(y0 + radius, Math.min(py, y1 - radius));
  // 到圆角化矩形「内区」的有符号距离：> 0 在外
  const outside = Math.hypot(px - cx, py - cy) - radius;
  // 到外接矩形的距离取反方向：边框带 = |到内区距离| 在 [0, thickness] 且在矩形内
  const inRect = px >= x0 && px <= x1 && py >= y0 && py <= y1;
  return { band: outside, inRect };
}

/**
 * 画一张图标。
 * @param size 画布边长
 * @param scale 内容整体缩放（maskable 用 ~0.8 收进安全区）
 */
function drawIcon(size, scale) {
  const rgba = Buffer.alloc(size * size * 4);
  const put = (x, y, color) => {
    const i = (y * size + x) * 4;
    rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = color[3];
  };
  const s = size * scale; // 内容区边长
  const off = (size - s) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 归一化到内容区坐标 [0,1]
      const u = (x - off) / s;
      const v = (y - off) / s;
      let color = PAPER;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        // 方框：内缩 margin，圆角半径 = 线宽
        const margin = 0.12, t = FRAME_RATIO, r = t;
        const x0 = margin, y0 = margin, x1 = 1 - margin, y1 = 1 - margin;
        const frame = distToRoundRectFrame(u * s, v * s, x0 * s, y0 * s, x1 * s, y1 * s, r * s);
        const onFrame =
          frame.inRect &&
          Math.abs(frame.band) <= (t / 2) * s &&
          // 外侧半带只算到外接矩形内（圆角外不算线）
          u >= x0 - t && u <= x1 + t && v >= y0 - t && v <= y1 + t;
        // 对勾：三段折线 (0.30,0.52)→(0.44,0.66)→(0.72,0.36)，圆头
        const cw = CHECK_RATIO;
        const d1 = distToSegment(u, v, 0.3, 0.52, 0.44, 0.66);
        const d2 = distToSegment(u, v, 0.44, 0.66, 0.72, 0.36);
        const onCheck = Math.min(d1, d2) <= cw / 2;
        if (onCheck) color = SEAL;
        else if (onFrame) color = SEAL;
      }
      put(x, y, color);
    }
  }
  return rgba;
}

mkdirSync(OUT, { recursive: true });
const jobs = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  // maskable：图形收进中央 80%，四周留纸色出血
  { file: 'icon-maskable-512.png', size: 512, scale: 0.8 },
  // iOS 主屏图标（无透明度要求，纸色底正好）
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
];
for (const { file, size, scale } of jobs) {
  const png = encodePng(size, size, drawIcon(size, scale));
  writeFileSync(join(OUT, file), png);
  console.log(`[gen-icons] ${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
