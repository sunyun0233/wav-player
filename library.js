const fs = require('node:fs');
const path = require('node:path');

const AUDIO_EXTS = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'];
const SUB_EXTS = ['vtt', 'srt'];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const SUB_DIRS = ['subtitle', 'subtitles', 'subs', 'lyrics', 'caption', 'captions', '字幕'];
const COVER_STEMS = ['cover', 'folder', 'front', 'album', 'back', 'art', '封面'];
const MEDIA_CAP = 4000;

function stemOf(fileName) {
  return path.basename(fileName, path.extname(fileName)).toLowerCase();
}

function normalizeName(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function subtitleMatchesAudio(subStem, audioNameLower, audioStem, audioExt) {
  const s = subStem;
  if (s === audioStem) return true;
  if (s === audioNameLower) return true;
  if (audioExt && s === audioStem + '.' + audioExt) return true;
  if (normalizeName(s) === normalizeName(audioStem)) return true;
  if (audioExt && s.toLowerCase().endsWith('.' + audioExt)) {
    const stripped = s.slice(0, -(audioExt.length + 1));
    if (normalizeName(stripped) === normalizeName(audioStem)) return true;
  }
  // 识别已翻译的中文字幕, 例如 "<audioName>.zh.vtt" / "<audioName>.cn.srt"
  const langCode = /\.(zh|cn)$/i.exec(s);
  if (langCode) {
    const stripped = s.slice(0, -langCode[0].length);
    if (stripped === audioStem) return true;
    if (audioExt && stripped === audioStem + '.' + audioExt) return true;
    if (normalizeName(stripped) === normalizeName(audioStem)) return true;
  }
  return false;
}

function findSubtitleInDir(dir, audioFile) {
  const audioStem = stemOf(audioFile);
  const audioNameLower = audioFile.toLowerCase();
  const audioExt = path.extname(audioFile).slice(1).toLowerCase();
  let vtt = null;
  let srt = null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (!SUB_EXTS.includes(ext)) continue;
      if (!subtitleMatchesAudio(stemOf(e.name), audioNameLower, audioStem, audioExt)) continue;
      if (ext === 'vtt' && !vtt) vtt = path.join(dir, e.name);
      else if (ext === 'srt' && !srt) srt = path.join(dir, e.name);
    }
  } catch (_error) {
    /* ignore */
  }
  return vtt || srt;
}

function findSubtitleFor(audioPath) {
  const dir = path.dirname(audioPath);
  const audioFile = path.basename(audioPath);
  let best = findSubtitleInDir(dir, audioFile);
  if (best) return best;
  for (const sub of SUB_DIRS) {
    const subDir = path.join(dir, sub);
    if (!fs.existsSync(subDir)) continue;
    best = findSubtitleInDir(subDir, audioFile);
    if (best) return best;
  }
  return null;
}

function findCoverInDir(dir, stem) {
  let stemMatch = null;
  const generic = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (!IMAGE_EXTS.includes(ext)) continue;
      const st = stemOf(e.name);
      if (st === stem && !stemMatch) stemMatch = path.join(dir, e.name);
      else if (COVER_STEMS.includes(st)) generic.push(path.join(dir, e.name));
    }
  } catch (_error) {
    /* ignore */
  }
  return stemMatch || generic[0] || null;
}

function findCoverForAudio(audioPath) {
  const dir = path.dirname(audioPath);
  const stem = stemOf(path.basename(audioPath));
  let best = findCoverInDir(dir, stem);
  if (best) return best;
  for (const sub of ['cover', 'covers', 'images', 'img', '封面']) {
    const subDir = path.join(dir, sub);
    if (!fs.existsSync(subDir)) continue;
    best = findCoverInDir(subDir, stem);
    if (best) return best;
  }
  return null;
}

function findFolderCover(folderPath) {
  const names = [
    'cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp',
    'folder.png', 'folder.jpg', 'folder.webp',
    'front.png', 'front.jpg', 'album.png', 'album.jpg',
    'back.png', 'back.jpg', 'art.png', 'art.jpg',
    '封面.png', '封面.jpg', '海报.png', '海报.jpg',
  ];
  for (const name of names) {
    const p = path.join(folderPath, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  try {
    for (const e of fs.readdirSync(folderPath, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (IMAGE_EXTS.includes(ext)) return path.join(folderPath, e.name);
    }
  } catch (_error) {
    /* ignore */
  }
  return null;
}

function walkFiles(root, out, depth) {
  if (out.length >= MEDIA_CAP || depth > 4) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_error) {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MEDIA_CAP) return;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, out, depth + 1);
    else if (entry.isFile()) {
      out.push({
        path: full,
        name: entry.name,
        dir: root,
        ext: path.extname(entry.name).slice(1).toLowerCase(),
        stem: stemOf(entry.name),
      });
    }
  }
}

// Build the playlist for a folder. Returns plain paths; the caller derives
// media URLs and registers the paths with the media protocol.
function buildLibrary(folderPath, opts) {
  const options = opts || {};
  const files = [];
  walkFiles(folderPath, files, 0);
  const audioFiles = files.filter((f) => AUDIO_EXTS.includes(f.ext));
  const subByStem = new Map();
  const imgByStem = new Map();
  for (const f of files) {
    if (SUB_EXTS.includes(f.ext)) {
      if (!subByStem.has(f.stem)) subByStem.set(f.stem, []);
      subByStem.get(f.stem).push(f);
    } else if (IMAGE_EXTS.includes(f.ext)) {
      if (!imgByStem.has(f.stem)) imgByStem.set(f.stem, []);
      imgByStem.get(f.stem).push(f);
    }
  }

  // 专辑(文件夹)级封面: 显式覆盖优先, 否则自动探测
  const override = options.folderCover && fs.existsSync(options.folderCover) ? options.folderCover : '';
  const folderCover = override || findFolderCover(folderPath);
  const tracks = [];
  for (const audio of audioFiles) {
    const audioNameLower = audio.name.toLowerCase();
    const audioExt = audio.ext;
    const candSet = new Set();
    for (const key of [audio.stem, audioNameLower, audio.stem + '.' + audioExt]) {
      for (const f of subByStem.get(key) || []) candSet.add(f);
    }
    let subCands = [...candSet];
    if (!subCands.length) {
      subCands = [...subByStem.values()].flat().filter((f) =>
        subtitleMatchesAudio(f.stem, audioNameLower, audio.stem, audioExt)
      );
    }
    const sameDirSubs = subCands.filter((s) => s.dir === audio.dir);
    const cuePool = sameDirSubs.length ? sameDirSubs : subCands;
    cuePool.sort((a, b) => (a.ext === 'vtt' ? 0 : 1) - (b.ext === 'vtt' ? 0 : 1) || a.name.localeCompare(b.name));
    const subFile = cuePool[0] || null;

    const coverCands = imgByStem.get(audio.stem) || [];
    let coverFile = coverCands.find((c) => c.dir === audio.dir) || coverCands[0] || null;
    if (!coverFile) coverFile = findCoverInDir(audio.dir, audio.stem);
    if (!coverFile) coverFile = folderCover;
    const coverPath = typeof coverFile === 'string' ? coverFile : coverFile ? coverFile.path : '';

    let size = 0;
    try {
      size = fs.statSync(audio.path).size;
    } catch (_error) {
      /* ignore */
    }

    tracks.push({
      path: audio.path,
      name: audio.name,
      ext: audio.ext,
      size,
      subPath: subFile ? subFile.path : '',
      subName: subFile ? subFile.name : '',
      coverPath,
    });
  }

  tracks.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return tracks;
}

module.exports = {
  AUDIO_EXTS,
  SUB_EXTS,
  IMAGE_EXTS,
  buildLibrary,
  findSubtitleFor,
  findCoverForAudio,
  findFolderCover,
};
