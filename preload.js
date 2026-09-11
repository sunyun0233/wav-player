const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openAudio: () => ipcRenderer.invoke('dialog:openAudio'),
  openSubtitle: () => ipcRenderer.invoke('dialog:openSubtitle'),
  openCover: () => ipcRenderer.invoke('dialog:openCover'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFolders: () => ipcRenderer.invoke('dialog:openFolders'),
  scanFolder: (folderPath) => ipcRenderer.invoke('library:scan', folderPath),
  scanFolderSummary: (folderPath) => ipcRenderer.invoke('library:scanSummary', folderPath),
  listSubfolders: (folderPath) => ipcRenderer.invoke('library:subfolders', folderPath),
  findSubtitle: (audioPath) => ipcRenderer.invoke('subtitle:find', audioPath),
  registerPath: (filePath) => ipcRenderer.invoke('media:registerPath', filePath),
  findCover: (audioPath) => ipcRenderer.invoke('cover:find', audioPath),
  saveCustomCover: (audioPath, coverPath) => ipcRenderer.invoke('cover:saveCustom', audioPath, coverPath),
  clearCustomCover: (audioPath) => ipcRenderer.invoke('cover:clearCustom', audioPath),
  setFolderCover: (folderPath, coverPath) => ipcRenderer.invoke('cover:setFolder', folderPath, coverPath),
  clearFolderCover: (folderPath) => ipcRenderer.invoke('cover:clearFolder', folderPath),
  folderCover: (folderPath) => ipcRenderer.invoke('cover:folderCover', folderPath),
  transcribeEnv: () => ipcRenderer.invoke('transcribe:env'),
  transcribePickModelDir: () => ipcRenderer.invoke('transcribe:pickModelDir'),
  transcribeStart: (command, config) => ipcRenderer.invoke('transcribe:start', command, config),
  transcribeCancel: (jobId) => ipcRenderer.invoke('transcribe:cancel', jobId),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_error) {
      return (file && file.path) || '';
    }
  },
  onMenuOpenAudio: (callback) => ipcRenderer.on('menu:openAudio', callback),
  onMenuOpenSubtitle: (callback) => ipcRenderer.on('menu:openSubtitle', callback),
  onMenuOpenFolder: (callback) => ipcRenderer.on('menu:openFolder', callback),
  onMenuOpenCover: (callback) => ipcRenderer.on('menu:openCover', callback),
  onMenuTranscribe: (callback) => ipcRenderer.on('menu:transcribe', callback),
  onTranscribeEvent: (callback) => ipcRenderer.on('transcribe:event', (_event, payload) => callback(payload)),
});
