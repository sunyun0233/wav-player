'use strict';
// 端到端 main 进程直连: 调用 transcribe.js -> Python -> GPU 模型。
// 仅用于开发验证, 不属于打包文件。
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const transcribe = require('../transcribe');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    backgroundColor: '#080914',
  });
  win.webContents.setBackgroundThrottling(false);
  await win.loadURL('about:blank');

  console.log('ENV', JSON.stringify(await transcribe.locatePython()));

  const audio = path.join(__dirname, '..', 'samples', 'zh', '01.和我分手后悔了？.wav');
  const output = audio + '.zh.vtt';
  if (fs.existsSync(output)) {
    fs.unlinkSync(output);
  }
  const config = {
    audio,
    model_dir: path.join(__dirname, '..', 'models', 'whisper-large-v2-translate-zh-v0.2-st-ct2'),
    output,
    format: 'vtt',
    device: 'auto',
    compute_type: 'auto',
    language: 'ja',
    task: 'translate',
    beam_size: 5,
    vad_filter: false,
  };

  const origSend = win.webContents.send.bind(win.webContents);
  win.webContents.send = (channel, payload) => {
    if (channel === 'transcribe:event') {
      console.log('EVENT', JSON.stringify(payload));
    }
    return origSend(channel, payload);
  };

  const res = transcribe.startJob(win, config, 'transcribe');
  console.log('JOB', JSON.stringify(res));

  await new Promise((resolve) => {
    const guard = setTimeout(() => resolve('timeout'), 180000);
    const timer = setInterval(() => {
      if (fs.existsSync(output)) {
        clearInterval(timer);
        clearTimeout(guard);
        resolve('done');
      }
    }, 400);
  });

  if (fs.existsSync(output)) {
    const text = fs.readFileSync(output, 'utf8');
    console.log('VTT size', fs.statSync(output).size, 'cues', (text.match(/-->/g) || []).length);
    console.log('VTT head:', text.split('\n').slice(0, 9).join(' | '));
  } else {
    console.log('VTT MISSING');
  }

  app.quit();
});
