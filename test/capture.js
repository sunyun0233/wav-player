const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const library = require('../library');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

const allowedPaths = new Set();

function mediaUrl(p) {
  return `media://local?p=${encodeURIComponent(p)}`;
}

ipcMain.handle('media:registerPath', async (_event, filePath) => {
  if (typeof filePath === 'string' && filePath) {
    allowedPaths.add(filePath);
    return mediaUrl(filePath);
  }
  return null;
});

ipcMain.handle('dialog:openCover', async () => null);
ipcMain.handle('cover:find', async (_event, audioPath) => {
  if (typeof audioPath !== 'string' || !audioPath) return null;
  const auto = library.findCoverForAudio(audioPath);
  if (!auto) return null;
  allowedPaths.add(auto);
  return { kind: 'auto', path: auto, url: mediaUrl(auto) };
});
ipcMain.handle('cover:saveCustom', async () => true);
ipcMain.handle('cover:clearCustom', async () => true);
ipcMain.handle('cover:setFolder', async () => true);
ipcMain.handle('cover:clearFolder', async () => true);
ipcMain.handle('cover:folderCover', async (_e, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) return null;
  const auto = library.findFolderCover(folderPath);
  if (!auto) return null;
  allowedPaths.add(auto);
  return { kind: 'auto', path: auto, url: mediaUrl(auto) };
});

ipcMain.handle('dialog:openFolder', async () => null);
ipcMain.handle('dialog:openFolders', async () => [
  path.resolve(__dirname, '..', 'samples', 'album'),
  path.resolve(__dirname, '..', 'samples', 'zh'),
]);
ipcMain.handle('library:scanSummary', async (_e, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) return null;
  const tracks = library.buildLibrary(folderPath);
  const cover = library.findFolderCover(folderPath) || '';
  if (cover) allowedPaths.add(cover);
  return {
    folderPath,
    name: path.basename(folderPath),
    coverPath: cover,
    coverUrl: cover ? mediaUrl(cover) : '',
    trackCount: tracks.length,
  };
});
ipcMain.handle('library:subfolders', async (_e, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) return [];
  try {
    return fs
      .readdirSync(folderPath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(folderPath, e.name));
  } catch (_e2) {
    return [];
  }
});
ipcMain.handle('library:scan', async (_e, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) return null;
  const raw = library.buildLibrary(folderPath);
  const tracks = raw.map((t) => {
    allowedPaths.add(t.path);
    if (t.subPath) allowedPaths.add(t.subPath);
    if (t.coverPath) allowedPaths.add(t.coverPath);
    return {
      path: t.path,
      url: mediaUrl(t.path),
      name: t.name,
      ext: t.ext,
      size: t.size,
      subPath: t.subPath || '',
      subUrl: t.subPath ? mediaUrl(t.subPath) : '',
      subName: t.subName || '',
      coverPath: t.coverPath || '',
      coverUrl: t.coverPath ? mediaUrl(t.coverPath) : '',
    };
  });
  const folderCover = library.findFolderCover(folderPath) || '';
  if (folderCover) allowedPaths.add(folderCover);
  return {
    folderPath,
    name: path.basename(folderPath),
    folderCover,
    folderCoverUrl: folderCover ? mediaUrl(folderCover) : '',
    tracks,
  };
});
ipcMain.handle('subtitle:find', async (_e, audioPath) => {
  if (!audioPath) return null;
  const p = library.findSubtitleFor(audioPath);
  if (!p) return null;
  allowedPaths.add(p);
  return { path: p, url: mediaUrl(p), name: path.basename(p) };
});

ipcMain.handle('transcribe:env', async () => ({
  type: 'env',
  python: 'C:\\fake\\python.exe',
  version: '3.11.9',
  platform: 'win32',
  faster_whisper: '1.0.3',
  ctranslate2: '4.5.0',
  av: '12.3.0',
  huggingface_hub: '0.28.1',
  cuda_devices: 1,
  compute_types: ['int8_float16', 'float16', 'int8'],
  missing: [],
  ok: true,
}));
ipcMain.handle('transcribe:pickModelDir', async () => null);
ipcMain.handle('transcribe:start', async (_e, command, config) => ({
  jobId: 'qa-job',
  _config: config,
}));
ipcMain.handle('transcribe:cancel', async () => true);

function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      const encoded = url.searchParams.get('p');
      if (!encoded) return new Response('Missing path', { status: 400 });
      const filePath = decodeURIComponent(encoded);
      if (!allowedPaths.has(filePath)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(filePath).toString(), {
        method: request.method || 'GET',
        headers: request.headers,
      });
    } catch (_error) {
      return new Response('Media error', { status: 500 });
    }
  });
}

app.whenReady().then(async () => {
  registerMediaProtocol();
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: '#080914',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
  win.setPosition(40, 40);
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
    search: '?qa=1',
  });

  const audioPath = path.resolve(__dirname, '..', 'samples', 'sample.wav');
  const subPath = path.resolve(__dirname, '..', 'samples', 'sample.vtt');
  const coverPath = path.resolve(__dirname, '..', 'samples', 'cover.png');
  const albumPath = path.resolve(__dirname, '..', 'samples', 'album');
  allowedPaths.add(audioPath);
  allowedPaths.add(subPath);
  allowedPaths.add(coverPath);

  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    await new Promise((r) => setTimeout(r, 450));
    const image = await win.webContents.capturePage();
    const out = path.join(__dirname, '..', name);
    fs.writeFileSync(out, image.toPNG());
    console.log('saved', out);
  };

  await shot('qa-empty.png');

  // single file + custom cover
  try {
    await js(
      `(async () => {
        await window.__qa.loadAudioPath(${JSON.stringify(audioPath)});
        await new Promise((r) => setTimeout(r, 1300));
        await window.__qa.loadSubtitlePath(${JSON.stringify(subPath)});
        await new Promise((r) => setTimeout(r, 400));
        await window.__qa.coverPath(${JSON.stringify(coverPath)});
        await new Promise((r) => setTimeout(r, 400));
        window.__qa.state.audio.currentTime = 6.5;
        await new Promise((r) => setTimeout(r, 160));
        window.__qa.togglePlay();
        await new Promise((r) => setTimeout(r, 1700));
        window.__qa.setView('subtitle');
        return true;
      })()`
    );
  } catch (error) {
    console.error('executeJavaScript error:', error);
  }
  await shot('qa-desktop.png');

  // folder -> playlist with auto subtitle/cover
  try {
    const result = await js(
      `(async () => {
        const n = await window.__qa.loadFolderPath(${JSON.stringify(albumPath)});
        await new Promise((r) => setTimeout(r, 1400));
        const rows = window.__qa.state.playlist.map((t) => ({
          name: t.name,
          sub: t.subName || '',
          cover: t.coverPath ? t.coverPath.split(/[\\\\/]/).pop() : '',
        }));
        window.__qa.playTrack(1);
        await new Promise((r) => setTimeout(r, 900));
        window.__qa.state.audio.currentTime = 0.2;
        await new Promise((r) => setTimeout(r, 160));
        window.__qa.togglePlay();
        await new Promise((r) => setTimeout(r, 900));
        window.__qa.setView('list');
        return { count: n, rows };
      })()`
    );
    console.log('folder associations', JSON.stringify(result));
  } catch (error) {
    console.error('folder scenario error:', error);
  }
  await shot('qa-folder.png');

  try {
    const wide = await js(
      '(() => { const r = document.querySelector(".stage").getBoundingClientRect(); return window.__qa.dragArchive(r.right - 470); })()'
    );
    console.log('archive width widened to', wide);
  } catch (_e) {}
  await shot('qa-folder-wide.png');

  await js('window.__qa.setView("subtitle")');
  await shot('qa-subtitle.png');

  // transcribe modal with simulated GPU env + progress + segment
  try {
    await js("window.__qa.setView('player')");
    await js("window.__qa.transcribe.open()");
    await new Promise((r) => setTimeout(r, 500));
    await js(
      `(async () => {
        window.__qa.transcribe.setEnv({ ok: true, cuda_devices: 1, version: '3.11.9', faster_whisper: '1.0.3', missing: [] });
        window.__qa.transcribe.beginFake('qa-job');
        await window.__qa.transcribe.detectEnv();
        window.__qa.transcribe.event({ jobId: 'qa-job', type: 'status', message: '模型已加载, 开始转写', detail: 'device=cuda compute_type=int8_float16' });
        window.__qa.transcribe.event({ jobId: 'qa-job', type: 'progress', percent: 42, completed: 4.2, total: 10 });
        window.__qa.transcribe.event({ jobId: 'qa-job', type: 'segment', start: 4.2, end: 6.1, text: '这里是没有忘记的约定。' });
        return true;
      })()`
    );
    await new Promise((r) => setTimeout(r, 400));
  } catch (error) {
    console.error('transcribe modal error:', error);
  }
  await shot('qa-transcribe.png');

  // complete the simulated transcription -> generates a local zh.vtt and auto-loads it
  try {
    const fakeVtt = path.join(__dirname, '..', 'samples', 'zh', '01.和我分手后悔了？.wav.zh.vtt');
    fs.writeFileSync(
      fakeVtt,
      'WEBVTT\n\ntranslated by WAV Player\n\n00:00:00.000 --> 00:00:03.000\n这是我离开之后的第一天。\n\n00:00:03.000 --> 00:00:06.200\n你不要再等了。\n',
      'utf8'
    );
    await js(
      `(async () => {
        window.__qa.transcribe.event({ jobId: 'qa-job', type: 'done', output: ${JSON.stringify(fakeVtt)}, count: 2, elapsed: 1.2 });
        await new Promise((r) => setTimeout(r, 600));
        window.__qa.setView('subtitle');
        return true;
      })()`
    );
    await new Promise((r) => setTimeout(r, 500));
  } catch (error) {
    console.error('transcribe done error:', error);
  }
  await shot('qa-transcribe-done.png');

  // albums view
  try {
    await js('window.__qa.transcribe.close()');
    await js("window.__qa.setView('albums')");
    await new Promise((r) => setTimeout(r, 700));
  } catch (error) {
    console.error('albums error:', error);
  }
  await shot('qa-albums.png');

  // album preview must NOT interrupt current playback
  try {
    const res = await js(
      `(async () => {
        await window.__qa.loadFolderPath(${JSON.stringify(albumPath)});
        await new Promise((r) => setTimeout(r, 1300));
        window.__qa.playTrack(1);
        await new Promise((r) => setTimeout(r, 800));
        window.__qa.state.audio.play().catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
        const before = { path: window.__qa.state.audioPath, paused: window.__qa.state.audio.paused, t: Number((window.__qa.state.audio.currentTime||0).toFixed(2)) };
        const other = window.__qa.albums.list().find((a) => a.name === 'samples') || window.__qa.albums.list()[0];
        await window.__qa.albums.preview(other);
        await new Promise((r) => setTimeout(r, 1100));
        const after = { path: window.__qa.state.audioPath, paused: window.__qa.state.audio.paused, t: Number((window.__qa.state.audio.currentTime||0).toFixed(2)), preview: !!window.__qa.albums.previewState() };
        window.__qa.setView('albums');
        return { before, after };
      })()`
    );
    console.log('album-preview-no-interrupt', JSON.stringify(res));
    await new Promise((r) => setTimeout(r, 700));
  } catch (error) {
    console.error('album preview error:', error);
  }
  await shot('qa-album-preview.png');

  // batch import (multi-select, mocked to two folders)
  try {
    const res = await js(
      `(async () => {
        const before = window.__qa.albums.list().length;
        await window.__qa.albums.importAlbums();
        await new Promise((r) => setTimeout(r, 900));
        window.__qa.setView('albums');
        return { before, after: window.__qa.albums.list().length, names: window.__qa.albums.list().map((a) => a.name) };
      })()`
    );
    console.log('album-batch-import', JSON.stringify(res));
    await new Promise((r) => setTimeout(r, 700));
  } catch (error) {
    console.error('batch import error:', error);
  }
  await shot('qa-album-import.png');

  // batch transcribe over the folder, simulated
  try {
    await js(
      `(async () => {
        await window.__qa.loadFolderPath(${JSON.stringify(albumPath)});
        await new Promise((r) => setTimeout(r, 1400));
        window.__qa.setView('player');
        window.__qa.transcribe.open();
        window.__qa.transcribe.setScope('folder');
        window.__qa.transcribe.setEnv({ ok: true, cuda_devices: 1, version: '3.11.9', faster_whisper: '1.0.3', missing: [] });
        await window.__qa.transcribe.start();
        const q = window.__qa.transcribe.queue();
        window.__qa.transcribe.event({ jobId: 'qa-job', type: 'batch', total: q.length });
        window.__qa.transcribe.event({ jobId: 'qa-job', type: 'file', index: 0, total: q.length, name: q[0].name, skipped: false });
        window.__qa.transcribe.event({ jobId: 'qa-job', type: 'progress', index: 0, percent: 55, completed: 5, total: 9 });
        window.__qa.transcribe.event({ jobId: 'qa-job', type: 'segment', index: 0, text: '第一段翻译结果。' });
        return true;
      })()`
    );
    await new Promise((r) => setTimeout(r, 500));
  } catch (error) {
    console.error('batch transcribe error:', error);
  }
  await shot('qa-transcribe-batch.png');

  try {
    await js(
      `(async () => {
        const q = window.__qa.transcribe.queue();
        for (let i = 0; i < q.length; i++) {
          window.__qa.transcribe.event({ jobId: 'qa-job', type: 'file', index: i, total: q.length, name: q[i].name, skipped: false });
          window.__qa.transcribe.event({ jobId: 'qa-job', type: 'file_done', index: i, output: q[i].path + '.zh.vtt', count: 3, elapsed: 1.1, skipped: false });
        }
        window.__qa.transcribe.event({ jobId: 'qa-job', type: 'done', total: q.length, ok: q.length, failed: 0, skipped: 0, outputs: [], elapsed: 5.5 });
        return true;
      })()`
    );
    await new Promise((r) => setTimeout(r, 500));
  } catch (error) {
    console.error('batch done error:', error);
  }
  await shot('qa-transcribe-batch-done.png');

  try {
    await js('window.__qa.setView("record")');
    const info = await js(
      '({view: window.__qa.state.view, t: document.querySelector("#panelTranscript").hidden, r: document.querySelector("#panelRecord").hidden})'
    );
    console.log('viewinfo', JSON.stringify(info));
  } catch (_e) {}
  await shot('qa-record.png');

  win.setBounds({ width: 460, height: 900 });
  win.setMinimumSize(1, 1);
  try {
    await js('window.__qa.setView("subtitle")');
  } catch (_e) {}
  await new Promise((r) => setTimeout(r, 600));
  await shot('qa-portrait.png');

  // session restore check: save -> reload -> expect restored folder/track/position
  try {
    win.setBounds({ width: 1280, height: 860 });
    const samplesRoot = path.resolve(__dirname, '..', 'samples');
    await js(
      `(async () => {
        await window.__qa.loadFolderPath(${JSON.stringify(samplesRoot)});
        await new Promise((r) => setTimeout(r, 1600));
        const idx = window.__qa.state.playlist.findIndex((t) => /sample\\.wav$/i.test(t.path));
        window.__qa.playTrack(idx >= 0 ? idx : 0);
        await new Promise((r) => setTimeout(r, 900));
        window.__qa.state.audio.currentTime = 6;
        window.__qa.session.save();
        return true;
      })()`
    );
    win.webContents.reload();
    await new Promise((r) => setTimeout(r, 3500));
    const restored = await js(
      '({ folder: window.__qa.state.folderPath, index: window.__qa.state.currentIndex, name: window.__qa.state.audioName, t: Number((window.__qa.state.audio.currentTime||0).toFixed(2)), albums: window.__qa.albums.list().length, pos: Object.keys(window.__qa.session.positions()).length })'
    );
    console.log('session restored', JSON.stringify(restored));
  } catch (error) {
    console.error('session test error:', error);
  }

  app.quit();
});
