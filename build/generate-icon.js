#!/usr/bin/env node
// Generates a placeholder PNG icon for the Electron desktop bundle and tray.
// Replace build/icon.png with a real asset before shipping a release.

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const RADIUS = 96;
const BG = [240, 192, 96];     // gold
const FG = [26, 20, 7];        // dark glyph

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'binary');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function inRoundedRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const dx = Math.min(x, w - 1 - x);
  const dy = Math.min(y, h - 1 - y);
  if (dx >= r || dy >= r) return true;
  return Math.hypot(r - dx, r - dy) <= r;
}

// Crude bitmap "A" glyph — chevron + crossbar, vector-style.
function drawA(x, y, cx, cy, half) {
  const top = cy - half;
  const bot = cy + half;
  const slope = (half * 1.05) / (half * 1.6);
  if (y < top || y > bot) return false;
  const t = (y - top) / (bot - top);
  const halfWidth = t * half * 0.9;
  const dx = Math.abs(x - cx);
  const inside = dx <= halfWidth + 4 && dx >= halfWidth - 26;
  // Crossbar
  const barY = cy + half * 0.25;
  const onBar = y >= barY && y <= barY + 28 && dx <= halfWidth - 10;
  return inside || onBar;
}

function build() {
  const stride = SIZE * 4 + 1;
  const raw = Buffer.alloc(stride * SIZE);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const half = SIZE * 0.36;

  for (let y = 0; y < SIZE; y++) {
    raw[y * stride] = 0; // filter byte
    for (let x = 0; x < SIZE; x++) {
      const off = y * stride + 1 + x * 4;
      if (!inRoundedRect(x, y, SIZE, SIZE, RADIUS)) {
        raw[off] = 0; raw[off + 1] = 0; raw[off + 2] = 0; raw[off + 3] = 0;
        continue;
      }
      let c = BG;
      if (drawA(x, y, cx, cy, half)) c = FG;
      raw[off] = c[0];
      raw[off + 1] = c[1];
      raw[off + 2] = c[2];
      raw[off + 3] = 255;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  const out = path.join(__dirname, 'icon.png');
  fs.writeFileSync(out, png);
  console.log(`Wrote ${out} (${png.length} bytes)`);
}

build();
