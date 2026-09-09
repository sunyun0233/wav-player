'use strict';

const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// 打包成 asar 后, Python 无法执行 asar 虚拟路径里的 .py。
// 若运行目录含 app.asar, 把路径重定向到 app.asar.unpacked 的真实文件 (配合 asarUnpack)。
function unpackPath(p) {
  return String(p).replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1');
}

const SCRIPT_PATH = unpackPath(path.join(__dirname, 'transcribe.py'));
const DEFAULT_REPO = 'chickenrice0721/whisper-large-v2-translate-zh-v0.2-st-ct2';
const DEFAULT_MODEL_DIR = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'resonance-archive',
  'models',
  DEFAULT_REPO.split('/')[1]
);

const jobs = new Map();
let resolvedEnv = null;
let jobSeq = 1;

function parseEmittingLine(line) {
  try {
    return JSON.parse(line);
  } catch (_e) {
    return null;
  }
}

function extractJsonLines(buffer) {
  const out = [];
  for (const line of buffer.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = parseEmittingLine(trimmed);
    if (obj) out.push(obj);
  }
  return out;
}

function execLine(args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    execFile(args[0], args.slice(1), { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function probeEnv(exe) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(exe, [SCRIPT_PATH, 'env'], {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
    } catch (_e) {
      resolve(null);
      return;
    }
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString('utf8');
    });
    proc.on('close', () => {
      for (const obj of extractJsonLines(buf)) {
        if (obj.type === 'env') {
          resolve(obj);
          return;
        }
      }
      resolve(null);
    });
    proc.on('error', () => resolve(null));
  });
}

async function locatePython() {
  const launchers = [
    ['py', '-3.11'],
    ['py', '-3.12'],
    ['py', '-3.10'],
    ['python'],
  ];
  const seen = new Set();
  // 常见安装路径兜底
  const candidatePaths = [
    'C:\\Users\\17304\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
    'C:\\Users\\17304\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
    'C:\\Users\\17304\\AppData\\Local\\Programs\\Python\\Python310\\python.exe',
    'C:\\Python311\\python.exe',
  ];
  const attempts = launchers.map((l) => l).concat(candidatePaths.map((p) => [p]));
  for (const la of attempts) {
    let exe = null;
    try {
      if (la.length === 1 && path.isAbsolute(la[0])) {
        exe = la[0];
      } else {
        const out = await execLine(la.concat(['-c', 'import sys;print(sys.executable)']), 6000);
        exe = String(out).split(/\r?\n/).pop().trim();
      }
    } catch (_e) {
      continue;
    }
    if (!exe || seen.has(exe) || !fs.existsSync(exe)) continue;
    seen.add(exe);
    const env = await probeEnv(exe);
    if (env && env.ok) {
      resolvedEnv = env;
      return env;
    }
    if (!resolvedEnv) resolvedEnv = env; // 记住最接近的探测结果
  }
  return resolvedEnv;
}

function getResolved() {
  return resolvedEnv;
}

function setResolved(env) {
  resolvedEnv = env;
}

function getDefaultModelDir() {
  return DEFAULT_MODEL_DIR;
}

function getDefaultRepo() {
  return DEFAULT_REPO;
}

function writeConfigFile(config) {
  const file = path.join(os.tmpdir(), `ra-transcribe-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(config), { encoding: 'utf8' });
  return file;
}

function startJob(win, config, command = 'transcribe') {
  const exe = resolvedEnv && resolvedEnv.python;
  if (!exe || !fs.existsSync(exe)) {
    return { error: 'python_not_found', message: '未找到带有 faster-whisper 的 Python 环境' };
  }

  const configFile = writeConfigFile(config);
  const jobId = `job-${jobSeq++}`;
  const proc = spawn(exe, [SCRIPT_PATH, command, '--config', configFile], {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  let stdout = '';
  const job = { proc, config, win, configFile, done: false };
  jobs.set(jobId, job);

  const send = (type, obj) => {
    if (!win.isDestroyed()) {
      win.webContents.send('transcribe:event', { jobId, type, ...obj });
    }
  };

  proc.stdout.on('data', (d) => {
    stdout += d.toString('utf8');
    const newline = stdout.lastIndexOf('\n');
    if (newline === -1) return;
    const lines = stdout.slice(0, newline);
    stdout = stdout.slice(newline + 1);
    for (const obj of extractJsonLines(lines)) {
      const type = obj.type;
      delete obj.type;
      send(type, obj);
      if (type === 'done' || type === 'error') {
        cleanup(jobId);
      }
    }
  });

  proc.stderr.on('data', (d) => {
    // 保留 stderr 暂不转发, 仅在结束时报错时携带
  });

  proc.on('close', (code) => {
    const jobInfo = jobs.get(jobId);
    if (!jobInfo) return;
    // 若尚未清理(非 done/error 退出), 视为异常结束
    send('error', {
      code: 'process_exited',
      message: `转写进程异常退出 (code ${code})`,
    });
    cleanup(jobId);
  });

  proc.on('error', (err) => {
    send('error', { code: 'spawn', message: String(err && err.message || err) });
    cleanup(jobId);
  });

  send('started', { jobId });
  return { jobId };
}

function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.done) return false;
  job.done = true;
  const pid = job.proc && job.proc.pid;
  if (pid) {
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    } catch (_e) {
      try {
        job.proc.kill();
      } catch (_e2) {}
    }
  }
  if (job.win && !job.win.isDestroyed()) {
    job.win.webContents.send('transcribe:event', { jobId, type: 'cancelled' });
  }
  cleanup(jobId);
  return true;
}

function cleanup(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  jobs.delete(jobId);
  try {
    if (job.configFile && fs.existsSync(job.configFile)) fs.unlinkSync(job.configFile);
  } catch (_e) {
    /* ignore */
  }
}

function cancelAll() {
  for (const jobId of Array.from(jobs.keys())) {
    cancelJob(jobId);
  }
}

module.exports = {
  locatePython,
  getResolved,
  setResolved,
  getDefaultModelDir,
  getDefaultRepo,
  startJob,
  cancelJob,
  cancelAll,
  DEFAULT_MODEL_DIR,
  DEFAULT_REPO,
};
