'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractCover } = require('../embedded-cover');

// 1x1 PNG
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082',
  'hex'
);

function syncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function buildId3() {
  const mime = Buffer.from('image/png\0', 'latin1');
  const payload = Buffer.concat([Buffer.from([0x00]), mime, Buffer.from([0x03]), Buffer.from([0x00]), PNG]);
  const frameHeader = Buffer.concat([
    Buffer.from('APIC', 'latin1'),
    Buffer.from([(payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff, 0x00, 0x00]),
  ]);
  const frame = Buffer.concat([frameHeader, payload]);
  const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([0x03, 0x00, 0x00]), syncsafe(frame.length)]);
  return Buffer.concat([header, frame]);
}

// WAV + ID3 chunk
function buildWav() {
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.write('WAVE', 8, 'latin1');
  const id3 = buildId3();
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write('ID3 ', 0, 'latin1');
  chunkHeader.writeUInt32LE(id3.length, 4);
  return Buffer.concat([riff, chunkHeader, id3, Buffer.alloc(64)]);
}

function check(label, buf, ext) {
  const file = path.join(os.tmpdir(), `cover-test-${label}.${ext}`);
  fs.writeFileSync(file, buf);
  const res = extractCover(file);
  const ok = res && res.ext === 'png' && res.data.equals(PNG);
  console.log(label, ok ? 'PASS' : 'FAIL', res ? `${res.ext} ${res.data.length}b` : 'null');
  fs.unlinkSync(file);
  return ok;
}

function buildFlac() {
  const mime = Buffer.from('image/png', 'latin1');
  const body = Buffer.concat([
    Buffer.from([0, 0, 0, 3]), // picture type
    Buffer.from([(mime.length >>> 24) & 0xff, (mime.length >>> 16) & 0xff, (mime.length >>> 8) & 0xff, mime.length & 0xff]),
    mime,
    Buffer.from([0, 0, 0, 0]), // desc len
    Buffer.from([(PNG.length >>> 24) & 0xff, (PNG.length >>> 16) & 0xff, (PNG.length >>> 8) & 0xff, PNG.length & 0xff]),
    PNG,
  ]);
  const header = Buffer.from([0x80 | 6, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff]);
  return Buffer.concat([Buffer.from('fLaC', 'latin1'), header, body, Buffer.alloc(32)]);
}

function buildMp4() {
  const size = 16 + PNG.length;
  const dataAtom = Buffer.concat([
    Buffer.from([(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff]),
    Buffer.from('data', 'latin1'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from([0, 0, 0, 0]),
    PNG,
  ]);
  return Buffer.concat([Buffer.from('ftypM4A ', 'latin1'), Buffer.alloc(16), Buffer.from('covr', 'latin1'), dataAtom, Buffer.alloc(32)]);
}

let pass = true;
pass = check('mp3-id3', Buffer.concat([buildId3(), Buffer.alloc(128)]), 'mp3') && pass;
pass = check('wav-id3', buildWav(), 'wav') && pass;
pass = check('flac', buildFlac(), 'flac') && pass;
pass = check('m4a', buildMp4(), 'm4a') && pass;
console.log(pass ? 'ALL PASS' : 'SOME FAILED');
process.exit(pass ? 0 : 1);
