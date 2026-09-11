const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  Menu,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const library = require('./library');
const transcribe = require('./transcribe');
const embeddedCover = require('./embedded-cover');

// Allow the renderer to fetch local media via a custom scheme.
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
const IMAGE_EXTS = library.IMAGE_EXTS;

function winFromEvent(event) {
  try {
    return BrowserWindow.fromWebContents(event.sender);
  } catch (_e) {
    return BrowserWindow.getAllWindows()[0] || null;
  }
}

function mediaUrl(filePath) {
  return `media://local?p=${encodeURIComponent(filePath)}`;
}

function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      const encoded = url.searchParams.get('p');
      if (!encoded) return new Response('Missing path', { status: 400 });
      const filePath = decodeURIComponent(encoded);
      if (!allowedPaths.has(filePath)) return new Response('Forbidden', { status: 403 });
      const target = pathToFileURL(filePath).toString();
      return net.fetch(target, {
        method: request.method || 'GET',
        headers: request.headers,
      });
    } catch (_error) {
      return new Response('Media error', { status: 500 });
    }
  });
}

function coverStorePath() {
  return path.join(app.getPath('userData'), 'cover-map.json');
}

function readCoverStore() {
  try {
    return JSON.parse(fs.readFileSync(coverStorePath(), 'utf8')) || {};
  } catch (_error) {
    return {};
  }
}

function writeCoverStore(store) {
  try {
    fs.writeFileSync(coverStorePath(), JSON.stringify(store));
  } catch (_error) {
    /* ignore write failures */
  }
}

function folderCoverStorePath() {
  return path.join(app.getPath('userData'), 'folder-cover-map.json');
}

function readFolderCoverStore() {
  try {
    return JSON.parse(fs.readFileSync(folderCoverStorePath(), 'utf8')) || {};
  } catch (_error) {
    return {};
  }
}

function writeFolderCoverStore(store) {
  try {
    fs.writeFileSync(folderCoverStorePath(), JSON.stringify(store));
  } catch (_error) {
    /* ignore write failures */
  }
}

function folderCoverOverride(folderPath) {
  if (typeof folderPath !== 'string' || !folderPath) return '';
  const store = readFolderCoverStore();
  const hit = store[folderPath];
  return hit && fs.existsSync(hit) ? hit : '';
}

// 提取音频内嵌封面并落盘缓存, 返回缓存文件路径 (内容寻址)
function embeddedCoverPath(audioPath) {
  if (typeof audioPath !== 'string' || !audioPath) return '';
  let res = null;
  try {
    res = embeddedCover.extractCover(audioPath);
  } catch (_error) {
    res = null;
  }
  if (!res || !res.data || !res.data.length) return '';
  try {
    const hash = crypto.createHash('sha1').update(res.data).digest('hex');
    const dir = path.join(app.getPath('userData'), 'embedded-covers');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${hash}.${res.ext || 'jpg'}`);
    if (!fs.existsSync(out)) fs.writeFileSync(out, res.data);
    return out;
  } catch (_error) {
    return '';
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#080914',
    show: false,
    autoHideMenuBar: true,
    title: 'WAV 播放器',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '载入文件夹…',
          accelerator: 'CmdOrCtrl+D',
          click: () => win.webContents.send('menu:openFolder'),
        },
        {
          label: '打开音频…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu:openAudio'),
        },
        {
          label: '打开字幕…',
          accelerator: 'CmdOrCtrl+T',
          click: () => win.webContents.send('menu:openSubtitle'),
        },
        {
          label: '打开封面…',
          click: () => win.webContents.send('menu:openCover'),
        },
        {
          label: '日文转中文…',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => win.webContents.send('menu:transcribe'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('dialog:openAudio', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择音频文件',
    properties: ['openFile'],
    filters: [
      { name: '音频文件', extensions: library.AUDIO_EXTS },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  allowedPaths.add(filePath);
  return { path: filePath, url: mediaUrl(filePath) };
});

ipcMain.handle('dialog:openSubtitle', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择字幕文件',
    properties: ['openFile'],
    filters: [
      { name: '字幕文件', extensions: library.SUB_EXTS },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  allowedPaths.add(filePath);
  return { path: filePath, url: mediaUrl(filePath) };
});

ipcMain.handle('dialog:openCover', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择封面图片',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: IMAGE_EXTS },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  allowedPaths.add(filePath);
  return { path: filePath, url: mediaUrl(filePath) };
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择音频文件夹',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openFolders', async () => {
  const result = await dialog.showOpenDialog({
    title: '批量导入专辑文件夹',
    properties: ['openDirectory', 'multiSelections'],
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths;
});

ipcMain.handle('media:registerPath', async (_event, filePath) => {
  if (typeof filePath === 'string' && filePath) {
    allowedPaths.add(filePath);
    return mediaUrl(filePath);
  }
  return null;
});

ipcMain.handle('cover:find', async (_event, audioPath) => {
  if (typeof audioPath !== 'string' || !audioPath) return null;
  const store = readCoverStore();
  const custom = store[audioPath];
  if (custom && fs.existsSync(custom)) {
    allowedPaths.add(custom);
    return { kind: 'custom', path: custom, url: mediaUrl(custom) };
  }
  // 专辑(文件夹)级封面覆盖
  const folderHit = folderCoverOverride(path.dirname(audioPath));
  if (folderHit) {
    allowedPaths.add(folderHit);
    return { kind: 'folder', path: folderHit, url: mediaUrl(folderHit) };
  }
  const auto = library.findCoverForAudio(audioPath);
  if (auto) {
    allowedPaths.add(auto);
    return { kind: 'auto', path: auto, url: mediaUrl(auto) };
  }
  // 内嵌封面
  const embedded = embeddedCoverPath(audioPath);
  if (embedded) {
    allowedPaths.add(embedded);
    return { kind: 'embedded', path: embedded, url: mediaUrl(embedded) };
  }
  return null;
});

ipcMain.handle('cover:setFolder', async (_event, folderPath, coverPath) => {
  if (!folderPath || !coverPath) return false;
  const store = readFolderCoverStore();
  store[folderPath] = coverPath;
  writeFolderCoverStore(store);
  allowedPaths.add(coverPath);
  return true;
});

ipcMain.handle('cover:clearFolder', async (_event, folderPath) => {
  if (!folderPath) return false;
  const store = readFolderCoverStore();
  if (store[folderPath]) {
    delete store[folderPath];
    writeFolderCoverStore(store);
  }
  return true;
});

ipcMain.handle('cover:folderCover', async (_event, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath) return null;
  const hit = folderCoverOverride(folderPath);
  if (hit) {
    allowedPaths.add(hit);
    return { kind: 'folder', path: hit, url: mediaUrl(hit) };
  }
  const auto = library.findFolderCover(folderPath);
  if (auto) {
    allowedPaths.add(auto);
    return { kind: 'auto', path: auto, url: mediaUrl(auto) };
  }
  return null;
});

ipcMain.handle('cover:saveCustom', async (_event, audioPath, coverPath) => {
  if (!audioPath || !coverPath) return false;
  const store = readCoverStore();
  store[audioPath] = coverPath;
  writeCoverStore(store);
  allowedPaths.add(coverPath);
  return true;
});

ipcMain.handle('cover:clearCustom', async (_event, audioPath) => {
  if (!audioPath) return false;
  const store = readCoverStore();
  if (store[audioPath]) {
    delete store[audioPath];
    writeCoverStore(store);
  }
  return true;
});

ipcMain.handle('library:scan', async (_event, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath || !fs.existsSync(folderPath)) return null;
  const override = folderCoverOverride(folderPath);
  const raw = library.buildLibrary(folderPath, { folderCover: override });
  const tracks = raw.map((t) => {
    allowedPaths.add(t.path);
    const track = {
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
    if (t.subPath) allowedPaths.add(t.subPath);
    if (t.coverPath) allowedPaths.add(t.coverPath);
    return track;
  });
  let folderCover = override || library.findFolderCover(folderPath) || '';
  if (!folderCover) {
    const withCover = tracks.find((t) => t.coverPath);
    if (withCover) folderCover = withCover.coverPath;
  }
  if (folderCover) allowedPaths.add(folderCover);
  return {
    folderPath,
    name: path.basename(folderPath) || folderPath,
    folderCover,
    folderCoverUrl: folderCover ? mediaUrl(folderCover) : '',
    tracks,
  };
});

// 只返回专辑摘要 (不含曲目列表), 用于批量导入
ipcMain.handle('library:scanSummary', async (_event, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath || !fs.existsSync(folderPath)) return null;
  const override = folderCoverOverride(folderPath);
  let tracks = [];
  try {
    tracks = library.buildLibrary(folderPath, { folderCover: override });
  } catch (_error) {
    return null;
  }
  let cover = override || library.findFolderCover(folderPath) || '';
  if (!cover) {
    const withCover = tracks.find((t) => t.coverPath);
    if (withCover) cover = withCover.coverPath;
  }
  if (cover) allowedPaths.add(cover);
  return {
    folderPath,
    name: path.basename(folderPath) || folderPath,
    coverPath: cover,
    coverUrl: cover ? mediaUrl(cover) : '',
    trackCount: tracks.length,
  };
});

ipcMain.handle('library:subfolders', async (_event, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath || !fs.existsSync(folderPath)) return [];
  try {
    return fs
      .readdirSync(folderPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(folderPath, entry.name))
      .slice(0, 400);
  } catch (_error) {
    return [];
  }
});

ipcMain.handle('subtitle:find', async (_event, audioPath) => {
  if (typeof audioPath !== 'string' || !audioPath) return null;
  const p = library.findSubtitleFor(audioPath);
  if (!p) return null;
  allowedPaths.add(p);
  return { path: p, url: mediaUrl(p), name: path.basename(p) };
});

ipcMain.handle('transcribe:env', async () => {
  return await transcribe.locatePython();
});

ipcMain.handle('transcribe:pickModelDir', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择日文转中文模型目录（CTranslate2）',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('transcribe:start', async (_event, command, config) => {
  const env = await transcribe.locatePython();
  if (!env) {
    return { error: 'python_not_found', message: '未找到带有 faster-whisper 的 Python 环境' };
  }
  const safeConfig = typeof config === 'object' && config ? config : {};
  return await transcribe.startJob(winFromEvent(_event), safeConfig, command === 'download' ? 'download' : 'transcribe');
});

ipcMain.handle('transcribe:cancel', async (_event, jobId) => {
  return transcribe.cancelJob(jobId);
});

app.whenReady().then(() => {
  registerMediaProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
