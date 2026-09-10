'use strict';

// 从音频文件中提取内嵌封面图 (ID3v2 APIC / FLAC PICTURE / MP4 covr / OGG base64)。
// 纯 Node 实现, 不依赖第三方库。

const fs = require('node:fs');
const path = require('node:path');

const HEAD_BYTES = 16 * 1024 * 1024; // 头部最多读 16MB (标签一般都在前面)
const TAIL_BYTES = 16 * 1024 * 1024; // MP4 的 moov 可能在尾部

function sniffExt(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (bytes.length >= 12 && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

function mimeToExt(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('bmp')) return 'bmp';
  return 'jpg';
}

function decodeSyncSafe(b) {
  return ((b[0] & 0x7f) << 21) | ((b[1] & 0x7f) << 14) | ((b[2] & 0x7f) << 7) | (b[3] & 0x7f);
}

// ID3v2 APIC 帧 -> { data, ext }
function parseApicFrame(frame) {
  if (frame.length < 4) return null;
  let p = 0;
  const enc = frame[p++];
  const mimeEnd = frame.indexOf(0, p);
  if (mimeEnd === -1) return null;
  const mime = frame.toString('latin1', p, mimeEnd);
  p = mimeEnd + 1;
  p += 1; // picture type

  // description 以 0x00 结尾; UTF-16 编码时是双字节 0x0000
  if (enc === 1 || enc === 2) {
    while (p + 1 < frame.length && !(frame[p] === 0 && frame[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    const d = frame.indexOf(0, p);
    if (d === -1) return null;
    p = d + 1;
  }
  if (p >= frame.length) return null;
  const data = frame.subarray(p);
  return { data, ext: mimeToExt(mime) || sniffExt(data) || 'jpg' };
}

// buf 起始处为 "ID3"
function parseId3v2(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return null;
  const version = buf[3];
  const flags = buf[5];
  const size = decodeSyncSafe(buf.subarray(6, 10));
  const end = Math.min(10 + size, buf.length);
  let off = 10;

  if (flags & 0x40) {
    // extended header
    if (version === 4) off += decodeSyncSafe(buf.subarray(off, off + 4));
    else off += buf.readUInt32BE(off) + 4;
  }

  while (off + 10 <= end) {
    const id = buf.toString('latin1', off, off + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    let frameSize;
    if (version === 4) frameSize = decodeSyncSafe(buf.subarray(off + 4, off + 8));
    else frameSize = buf.readUInt32BE(off + 4);
    if (frameSize <= 0 || off + 10 + frameSize > buf.length) break;
    if (id === 'APIC') {
      const pic = parseApicFrame(buf.subarray(off + 10, off + 10 + frameSize));
      if (pic) return pic;
    }
    off += 10 + frameSize;
  }
  return null;
}

// FLAC PICTURE 块 -> { data, ext }
function parseFlacPicture(block) {
  try {
    let p = 0;
    p += 4; // picture type
    const mimeLen = block.readUInt32BE(p);
    p += 4;
    const mime = block.toString('latin1', p, p + mimeLen);
    p += mimeLen;
    const descLen = block.readUInt32BE(p);
    p += 4 + descLen;
    const dataLen = block.readUInt32BE(p);
    p += 4;
    const data = block.subarray(p, p + dataLen);
    if (!data.length) return null;
    return { data, ext: mimeToExt(mime) || sniffExt(data) || 'jpg' };
  } catch (_e) {
    return null;
  }
}

function parseFlac(buf) {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'fLaC') return null;
  let off = 4;
  while (off + 4 <= buf.length) {
    const header = buf[off];
    const type = header & 0x7f;
    const last = header & 0x80;
    const len = buf.readUIntBE(off + 1, 3);
    if (off + 4 + len > buf.length) break;
    if (type === 6) {
      const pic = parseFlacPicture(buf.subarray(off + 4, off + 4 + len));
      if (pic) return pic;
    }
    off += 4 + len;
    if (last) break;
  }
  return null;
}

// MP4/M4A: 扫描 'covr' 原子, 其内部第一个 'data' 子原子含图片
function parseMp4Atoms(buf) {
  let idx = buf.indexOf(Buffer.from('covr', 'latin1'));
  while (idx !== -1) {
    const p = idx + 4;
    if (p + 16 <= buf.length) {
      const size = buf.readUInt32BE(p);
      const kind = buf.toString('latin1', p + 4, p + 8);
      if (kind === 'data' && size > 16 && p + size <= buf.length) {
        const data = buf.subarray(p + 16, p + size);
        if (data.length) return { data, ext: sniffExt(data) || 'jpg' };
      }
    }
    idx = buf.indexOf(Buffer.from('covr', 'latin1'), idx + 4);
  }
  return null;
}

// OGG/Opus: METADATA_BLOCK_PICTURE=<base64 FLAC picture>
function parseOgg(buf) {
  if (buf.toString('latin1', 0, 4) !== 'OggS') return null;
  const marker = Buffer.from('METADATA_BLOCK_PICTURE=', 'latin1');
  let idx = buf.indexOf(marker);
  if (idx === -1) return null;
  let p = idx + marker.length;
  let end = p;
  while (end < buf.length && /[A-Za-z0-9+/=]/.test(String.fromCharCode(buf[end]))) end += 1;
  if (end === p) return null;
  try {
    const decoded = Buffer.from(buf.toString('latin1', p, end), 'base64');
    return parseFlacPicture(decoded);
  } catch (_e) {
    return null;
  }
}

function readHead(filePath, size) {
  const len = Math.min(size, HEAD_BYTES);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function readTail(filePath, size) {
  const len = Math.min(size, TAIL_BYTES);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, Math.max(0, size - len));
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

const MP4_EXTS = new Set(['mp4', 'm4a', 'm4b', 'aac', 'mov']);

// 在 buffer 中查找合法的 ID3v2 标签起点: "ID3" + 版本(2/3/4) + 0x00
function findId3Offset(buf, from) {
  let idx = buf.indexOf(Buffer.from('ID3', 'latin1'), from || 0);
  while (idx !== -1) {
    const v = buf[idx + 3];
    const f = buf[idx + 4];
    if ((v === 2 || v === 3 || v === 4) && f === 0) return idx;
    idx = buf.indexOf(Buffer.from('ID3', 'latin1'), idx + 3);
  }
  return -1;
}

// 主入口: 返回 { data: Buffer, ext } 或 null
function extractCover(audioPath) {
  let size = 0;
  try {
    size = fs.statSync(audioPath).size;
  } catch (_e) {
    return null;
  }
  if (!size) return null;

  let head;
  try {
    head = readHead(audioPath, size);
  } catch (_e) {
    return null;
  }

  const ext = path.extname(audioPath).slice(1).toLowerCase();

  // 1) 文件头就是 ID3 (mp3 / aiff 等)
  if (head.toString('latin1', 0, 3) === 'ID3') {
    const pic = parseId3v2(head);
    if (pic) return pic;
  }

  // 2) WAV 等容器里的 "ID3 " 块 (按标签签名定位真正的起点)
  const id3Offset = findId3Offset(head, 1);
  if (id3Offset > 0) {
    const pic = parseId3v2(head.subarray(id3Offset));
    if (pic) return pic;
  }

  // 3) FLAC
  const flac = parseFlac(head);
  if (flac) return flac;

  // 4) OGG / Opus
  const ogg = parseOgg(head);
  if (ogg) return ogg;

  // 5) MP4 家族 (moov 可能在尾部)
  const mp4 = parseMp4Atoms(head) || (MP4_EXTS.has(ext) && size > head.length ? parseMp4Atoms(readTail(audioPath, size)) : null);
  if (mp4) return mp4;

  // 6) 兜底: 任意位置出现 ID3 标签
  return null;
}

module.exports = { extractCover };
