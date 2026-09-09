(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AUDIO_EXT = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'];
  const SUB_EXT = ['vtt', 'srt'];
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
  const SPEEDS = [1, 1.25, 1.5, 2, 0.75, 0.5];

  const api = window.api || {
    openAudio: async () => null,
    openSubtitle: async () => null,
    openCover: async () => null,
    openFolder: async () => null,
    scanFolder: async () => null,
    findSubtitle: async () => null,
    registerPath: async () => null,
    findCover: async () => null,
    saveCustomCover: async () => false,
    clearCustomCover: async () => false,
    transcribeEnv: async () => null,
    transcribePickModelDir: async () => null,
    transcribeStart: async () => ({ error: 'unavailable' }),
    transcribeCancel: async () => false,
    getPathForFile: (file) => (file && file.path) || '',
    onMenuOpenAudio: () => {},
    onMenuOpenSubtitle: () => {},
    onMenuOpenFolder: () => {},
    onMenuOpenCover: () => {},
    onMenuTranscribe: () => {},
  };

  const state = {
    audio: new Audio(),
    audioReady: false,
    audioName: '',
    audioPath: '',
    audioUrl: '',
    duration: 0,
    size: 0,
    sampleRate: 0,
    channels: 0,
    bits: 0,
    wavMeta: null,
    peaks: null,
    cues: [],
    activeIndex: -1,
    speedPos: 0,
    loop: false,
    ab: { on: false, a: null, b: null },
    view: 'transcript',
    cover: { url: null, path: '', kind: 'none' },
    coverDisabled: false,
    pendingCustom: null,
    playlist: [],
    currentIndex: -1,
    folderName: '',
    transcribe: {
      jobId: null,
      running: false,
      modelSource: 'download',
      modelDir: '',
      device: 'auto',
      compute: 'auto',
      progress: 0,
      statusMsg: '',
      env: null,
    },
  };

  const el = {
    statusText: $('#statusText'),
    pulse: $('.pulse'),
    empty: $('#emptyState'),
    playerZone: $('#playerZone'),
    trackTitle: $('#trackTitle'),
    trackMeta: $('#trackMeta'),
    waveWrap: $('#waveWrap'),
    waveSvg: $('#waveSvg'),
    waveLoading: $('#waveLoading'),
    playhead: $('#playhead'),
    abA: $('#abA'),
    abB: $('#abB'),
    subtitleLine: $('#subtitleLine'),
    timeCurrent: $('#timeCurrent'),
    timeTotal: $('#timeTotal'),
    seekBar: $('#seekBar'),
    btnStart: $('#btnStart'),
    btnBack: $('#btnBack'),
    btnPlay: $('#btnPlay'),
    btnFwd: $('#btnFwd'),
    btnEnd: $('#btnEnd'),
    btnAB: $('#btnAB'),
    btnLoop: $('#btnLoop'),
    btnSpeed: $('#btnSpeed'),
    btnMute: $('#btnMute'),
    volBar: $('#volBar'),
    volIcon: $('#volIcon'),
    transcriptList: $('#transcriptList'),
    transcriptEmpty: $('#transcriptEmpty'),
    recordDetails: $('#recordDetails'),
    archive: $('#archive'),
    stage: $('.stage'),
    coverBtn: $('#coverBtn'),
    coverCard: $('#coverCard'),
    coverImage: $('#coverImage'),
    coverPlaceholder: $('#coverPlaceholder'),
    coverRemove: $('#coverRemove'),
    coverCaption: $('#coverCaption'),
    coverBackdrop: $('#coverBackdrop'),
    openFolderBtn: $('#openFolderBtn'),
    emptyOpenFolder: $('#emptyOpenFolder'),
    playlistList: $('#playlistList'),
    playlistEmpty: $('#playlistEmpty'),
    playAllBtn: $('#playAllBtn'),
    resizer: $('#archiveResizer'),
    btnTranscribe: $('#btnTranscribe'),
    transcribeModal: $('#transcribeModal'),
    transcribeClose: $('#transcribeClose'),
    transcribeModel: $('#transcribeModel'),
    transcribeBrowse: $('#transcribeBrowse'),
    transcribeModelHint: $('#transcribeModelHint'),
    transcribeDevice: $('#transcribeDevice'),
    transcribeCompute: $('#transcribeCompute'),
    transcribeEnvNote: $('#transcribeEnvNote'),
    transcribeStatus: $('#transcribeStatus'),
    transcribeProgressWrap: $('#transcribeProgressWrap'),
    transcribeBar: $('#transcribeBar'),
    transcribePct: $('#transcribePct'),
    transcribeSegment: $('#transcribeSegment'),
    transcribeStart: $('#transcribeStart'),
    transcribeCancel: $('#transcribeCancel'),
  };

  // ---------- helpers ----------
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function currentDuration() {
    const d = state.audio.duration;
    if (typeof d === 'number' && isFinite(d) && d > 0) return d;
    return typeof state.duration === 'number' && isFinite(state.duration) && state.duration > 0
      ? state.duration
      : 0;
  }

  function basename(p) {
    const parts = String(p || '').split(/[\\/]/);
    return parts[parts.length - 1] || p || '';
  }

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name);
    return m ? m[1].toLowerCase() : '';
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatTime(totalSeconds) {
    if (!isFinite(totalSeconds) || totalSeconds < 0) return '00:00';
    const secs = Math.floor(totalSeconds % 60);
    const mins = Math.floor(totalSeconds / 60) % 60;
    const hrs = Math.floor(totalSeconds / 3600);
    if (hrs > 0) return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    return `${pad(mins)}:${pad(secs)}`;
  }

  function formatSize(bytes) {
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return (v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)) + ' ' + units[i];
  }

  function setStatus(text, kind) {
    el.statusText.textContent = text;
    el.pulse.classList.remove('is-ok', 'is-idle', 'is-warn');
    if (kind === 'ok') el.pulse.classList.add('is-ok');
    else if (kind === 'warn') el.pulse.classList.add('is-warn');
    else el.pulse.classList.add('is-idle');
  }

  function setBusy(busy) {
    document.body.classList.toggle('is-busy', busy);
  }

  // ---------- view switching ----------
  const railItems = $$('.rail-item[data-view]');

  function setView(view) {
    state.view = view;
    railItems.forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle('is-active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });

    const showArchive = view !== 'player';
    el.archive.style.display = showArchive ? '' : 'none';
    el.stage.classList.toggle('is-player-only', !showArchive);

    $('#panelPlaylist').hidden = view !== 'list';
    $('#panelTranscript').hidden = view !== 'subtitle';
    $('#panelRecord').hidden = view !== 'record';
    if (view === 'record') updateRecord();
  }

  railItems.forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // ---------- open dialogs ----------
  async function openAudioDialog() {
    const res = await api.openAudio();
    if (!res) return;
    playSingle(res);
  }

  async function openSubtitleDialog() {
    const res = await api.openSubtitle();
    if (!res) return;
    loadSubtitle(res);
  }

  $('#openAudioBtn').addEventListener('click', openAudioDialog);
  $('#openSubBtn').addEventListener('click', openSubtitleDialog);
  $('#emptyOpenAudio').addEventListener('click', openAudioDialog);
  $('#emptyOpenSub').addEventListener('click', openSubtitleDialog);
  api.onMenuOpenAudio(openAudioDialog);
  api.onMenuOpenSubtitle(openSubtitleDialog);
  api.onMenuOpenFolder(loadFolder);
  api.onMenuOpenCover(openCoverDialog);

  // ---------- cover ----------
  async function openCoverDialog() {
    const res = await api.openCover();
    if (!res) return;
    await setCustomCover(res);
  }

  async function setCustomCover(res) {
    const source = { url: res.url, path: res.path || '', kind: 'custom' };
    if (!state.audioReady) {
      state.pendingCustom = source;
      state.cover = source;
      setStatus('已选择封面，加载音频后生效', 'ok');
      updateCoverUI();
      return;
    }
    state.cover = source;
    state.coverDisabled = false;
    if (state.audioPath && source.path) await api.saveCustomCover(state.audioPath, source.path);
    updateCoverUI();
    setStatus('已设置自定义封面', 'ok');
  }

  async function clearCover() {
    state.coverDisabled = true;
    state.pendingCustom = null;
    state.cover = { url: null, path: '', kind: 'none' };
    if (state.audioPath) await api.clearCustomCover(state.audioPath);
    updateCoverUI();
    setStatus('已移除封面', 'warn');
  }

  async function resolveCover(audioPath) {
    if (state.coverDisabled) {
      state.cover = { url: null, path: '', kind: 'none' };
      updateCoverUI();
      return;
    }
    if (state.pendingCustom) {
      const pending = state.pendingCustom;
      state.pendingCustom = null;
      state.cover = pending;
      if (audioPath && pending.path) await api.saveCustomCover(audioPath, pending.path);
      updateCoverUI();
      return;
    }
    if (!audioPath) {
      state.cover = { url: null, path: '', kind: 'none' };
      updateCoverUI();
      return;
    }
    const found = await api.findCover(audioPath);
    if (found) state.cover = { url: found.url, path: found.path || '', kind: found.kind };
    else state.cover = { url: null, path: '', kind: 'none' };
    updateCoverUI();
  }

  function applyTrackCover(track) {
    state.coverDisabled = false;
    if (track && track.coverUrl) {
      api
        .findCover(state.audioPath)
        .then((found) => {
          if (found && found.kind === 'custom') {
            state.cover = { url: found.url, path: found.path, kind: 'custom' };
          } else {
            state.cover = { url: track.coverUrl, path: track.coverPath, kind: 'auto' };
          }
          updateCoverUI();
        })
        .catch(() => {
          state.cover = { url: track.coverUrl, path: track.coverPath, kind: 'auto' };
          updateCoverUI();
        });
    } else {
      resolveCover(state.audioPath);
    }
  }

  function updateCoverUI() {
    const cover = state.cover;
    const hasCover = !!(cover && cover.url);
    el.coverImage.style.backgroundImage = hasCover ? `url("${cover.url}")` : 'none';
    el.coverBackdrop.style.backgroundImage = hasCover ? `url("${cover.url}")` : 'none';
    el.coverBackdrop.style.opacity = hasCover ? '1' : '0';
    el.coverCard.classList.toggle('has-cover', hasCover);
    el.coverPlaceholder.classList.toggle('is-hidden', hasCover);
    el.coverRemove.classList.toggle('is-hidden', !hasCover);
    el.coverCaption.textContent = !state.audioReady
      ? '点击选择封面'
      : hasCover
        ? cover.kind === 'custom'
          ? '自定义封面'
          : '已显示封面'
        : '未设置封面';
  }

  $('#coverBtn').addEventListener('click', openCoverDialog);
  $('#emptyCover').addEventListener('click', openCoverDialog);
  el.coverCard.addEventListener('click', openCoverDialog);
  el.coverRemove.addEventListener('click', clearCover);
  updateCoverUI();

  // ---------- playlist / folder ----------
  function fmtSizeShort(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return (v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)) + ' ' + units[i];
  }

  function renderPlaylist() {
    const list = state.playlist;
    el.playlistList.querySelectorAll('.pl-item').forEach((n) => n.remove());
    if (!list.length) {
      el.playlistEmpty.style.display = '';
      return;
    }
    el.playlistEmpty.style.display = 'none';
    list.forEach((track, index) => {
      const item = document.createElement('div');
      item.className = 'pl-item' + (index === state.currentIndex ? ' is-active' : '');
      item.setAttribute('role', 'listitem');
      item.setAttribute('data-index', String(index));

      const idx = document.createElement('span');
      idx.className = 'pl-index';
      idx.textContent = String(index + 1).padStart(2, '0');

      const main = document.createElement('span');
      main.className = 'pl-main';
      const name = document.createElement('span');
      name.className = 'pl-name';
      name.textContent = track.name;
      const badges = document.createElement('span');
      badges.className = 'pl-badges';
      if (track.subUrl) {
        const b = document.createElement('span');
        b.className = 'pl-badge';
        b.textContent = '字幕';
        badges.appendChild(b);
      }
      if (track.coverUrl) {
        const cb = document.createElement('span');
        cb.className = 'pl-badge is-cover';
        cb.textContent = '封面';
        badges.appendChild(cb);
      }
      main.appendChild(name);
      main.appendChild(badges);

      const meta = document.createElement('span');
      meta.className = 'pl-meta';
      meta.textContent = (track.ext ? track.ext.toUpperCase() : '') + (track.size ? ' · ' + fmtSizeShort(track.size) : '');

      item.appendChild(idx);
      item.appendChild(main);
      item.appendChild(meta);
      item.addEventListener('click', () => loadTrack(index));
      el.playlistList.appendChild(item);
    });
  }

  function loadTrack(index) {
    if (index < 0 || index >= state.playlist.length) return;
    const track = state.playlist[index];
    state.currentIndex = index;
    loadAudio({ url: track.url, path: track.path, name: track.name }, track, !state.audio.paused);
    renderPlaylist();
  }

  function prevTrack() {
    if (!state.playlist.length) return;
    loadTrack((state.currentIndex - 1 + state.playlist.length) % state.playlist.length);
  }

  function nextTrack() {
    if (!state.playlist.length) return;
    loadTrack((state.currentIndex + 1) % state.playlist.length);
  }

  function playAll() {
    if (!state.playlist.length) return;
    loadTrack(0);
    if (state.audioReady) state.audio.play().catch(() => {});
  }

  async function loadFolder() {
    const folderPath = await api.openFolder();
    if (!folderPath) return;
    setStatus('正在扫描文件夹…', 'ok');
    const library = await api.scanFolder(folderPath);
    if (!library || !library.tracks.length) {
      setStatus('该文件夹没有可播放的音频', 'warn');
      return;
    }
    state.playlist = library.tracks;
    state.folderName = library.name;
    setView('list');
    renderPlaylist();
    setStatus(`已载入 ${library.tracks.length} 个音频`, 'ok');
    loadTrack(0);
  }

  function playSingle(source) {
    const track = {
      path: source.path || '',
      url: source.url,
      name: source.name || basename(source.path || ''),
      ext: extOf(source.name || source.path || ''),
      size: 0,
      subPath: '',
      subUrl: '',
      subName: '',
      coverPath: '',
      coverUrl: '',
    };
    state.playlist = [track];
    state.currentIndex = 0;
    state.folderName = '';
    renderPlaylist();
    setView('subtitle');
    loadAudio(source, track, !state.audio.paused);
  }

  $('#openFolderBtn').addEventListener('click', loadFolder);
  $('#emptyOpenFolder').addEventListener('click', loadFolder);
  el.playAllBtn.addEventListener('click', playAll);
  renderPlaylist();

  // ---------- audio loading ----------
  async function loadAudio(source, track, autoplay = false) {
    const { url, path, name } = source;
    const resumePlay = autoplay || !state.audio.paused;
    state.audio.src = url;
    state.audio.load();
    state.audioPath = path || '';
    state.audioUrl = url;
    state.audioName = name;
    state.audioReady = true;
    state.wavMeta = null;
    state.sampleRate = 0;
    state.channels = 0;
    state.bits = 0;
    state.size = 0;
    state.cues = [];
    state.activeIndex = -1;
    state.ab = { on: false, a: null, b: null };
    state.loop = false;
    state.speedPos = 0;
    state.audio.playbackRate = 1;
    state.audio.volume = 1;
    state.audio.loop = false;
    state.coverDisabled = false;
    el.abA.hidden = true;
    el.abB.hidden = true;
    updateAbUI();
    updateTransportDisabled(false);

    el.empty.hidden = true;
    el.playerZone.hidden = false;
    applyTrackCover(track);
    el.trackTitle.textContent = name;
    el.trackMeta.textContent = '正在解析…';
    el.subtitleLine.textContent = '字幕将在此同步显示';
    el.subtitleLine.classList.add('is-empty');
    resetTranscript();
    setStatus('载入中', 'ok');
    setBusy(true);
    el.waveLoading.hidden = true;
    el.waveSvg.innerHTML = '';
    el.waveLoading.hidden = false;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('读取失败 ' + res.status);
      const buf = await res.arrayBuffer();
      state.size = buf.byteLength;
      state.wavMeta = parseWavHeader(buf);
      if (state.wavMeta) {
        state.sampleRate = state.wavMeta.sampleRate;
        state.channels = state.wavMeta.channels;
        state.bits = state.wavMeta.bits;
      }
      const decoded = await decodeAudio(buf);
      state.duration = decoded.duration;
      state.peaks = decoded.peaks;
      if (!state.sampleRate) state.sampleRate = decoded.sampleRate;
      if (!state.channels) state.channels = decoded.channels;
      el.waveLoading.hidden = true;
      renderWaveform();
      updateTransport();
      updateMeta();
      updateRecord();
      setStatus('RECORD LOADED', 'ok');
    } catch (err) {
      console.error(err);
      el.waveLoading.hidden = true;
      el.trackMeta.textContent = '解码失败';
      setStatus('解码失败', 'warn');
    } finally {
      setBusy(false);
    }

    if (track && track.subUrl) {
      loadSubtitle({ url: track.subUrl, path: track.subPath, name: track.subName || basename(track.subPath) });
    } else if (path) {
      tryAutoSubtitle(path);
    }
    if (resumePlay) state.audio.play().catch(() => {});
  }

  function updateMeta() {
    const bits = state.bits ? ` · ${state.bits} bit` : '';
    const ch = state.channels === 2 ? ' · 立体声' : state.channels === 1 ? ' · 单声道' : '';
    const fmt = state.wavMeta ? 'WAV' : extOf(state.audioName).toUpperCase() || 'AUDIO';
    el.trackMeta.textContent = `${fmt}${ch}${bits} · ${formatSize(state.size)} · ${formatTime(state.duration)}`;
  }

  function decodeAudio(buf) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    return ctx.decodeAudioData(buf.slice(0)).then((audioBuffer) => {
      const channels = audioBuffer.numberOfChannels;
      const length = audioBuffer.length;
      const width = el.waveWrap.clientWidth || 900;
      const target = clamp(Math.round(width / 2.5), 200, 1400);
      const block = Math.max(1, Math.ceil(length / target));
      const channelData = [];
      for (let c = 0; c < channels; c++) channelData.push(audioBuffer.getChannelData(c));
      const peaks = new Float32Array(target);
      for (let i = 0; i < target; i++) {
        const s = i * block;
        const e = Math.min(s + block, length);
        let max = 0;
        for (let c = 0; c < channels; c++) {
          const cd = channelData[c];
          for (let j = s; j < e; j++) {
            const v = cd[j] < 0 ? -cd[j] : cd[j];
            if (v > max) max = v;
          }
        }
        peaks[i] = max;
      }
      ctx.close();
      return { duration: audioBuffer.duration, sampleRate: audioBuffer.sampleRate, channels, peaks };
    });
  }

  function parseWavHeader(buf) {
    const dv = new DataView(buf);
    if (dv.byteLength < 12 || dv.getUint32(0, false) !== 0x52494646) return null; // RIFF
    let offset = 12;
    while (offset + 8 <= dv.byteLength) {
      const id = dv.getUint32(offset, false);
      const size = dv.getUint32(offset + 4, true);
      if (id === 0x666d7420) {
        // 'fmt '
        return {
          audioFormat: dv.getUint16(offset + 8, true),
          channels: dv.getUint16(offset + 10, true),
          sampleRate: dv.getUint32(offset + 12, true),
          bits: dv.getUint16(offset + 22, true),
        };
      }
      offset += 8 + size + (size % 2);
    }
    return null;
  }

  const BASE_FILL = 'rgb(255 255 255 / .16)';
  const SLOT = 4;

  function renderWaveform() {
    const n = state.peaks ? state.peaks.length : 0;
    if (!n) {
      el.waveSvg.innerHTML = '';
      return;
    }
    const height = 100;
    const mid = height / 2;
    let base = '';
    let prog = '';
    for (let i = 0; i < n; i++) {
      const v = state.peaks[i];
      const h = Math.max(1.2, v * height * 0.92);
      const x = i * SLOT;
      const y = mid - h / 2;
      base += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(SLOT - 1).toFixed(2)}" height="${h.toFixed(2)}" fill="${BASE_FILL}"/>`;
      prog += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(SLOT - 1).toFixed(2)}" height="${h.toFixed(2)}" fill="currentColor"/>`;
    }
    el.waveSvg.setAttribute('viewBox', `0 0 ${n * SLOT} ${height}`);
    el.waveSvg.innerHTML =
      '<defs><clipPath id="waveClip"><rect id="waveClipRect" x="0" y="0" width="0" height="' +
      height +
      '"/></clipPath></defs>' +
      '<g>' + base + '</g>' +
      '<g clip-path="url(#waveClip)">' + prog + '</g>';
    // progress group inherits currentColor from the svg (set to signal).
    el.waveSvg.style.color = 'var(--signal)';
  }

  // ---------- subtitle ----------
  function resetTranscript() {
    el.transcriptList.querySelectorAll('.cue-item').forEach((n) => n.remove());
    el.transcriptEmpty.style.display = '';
  }

  function renderTranscript() {
    el.transcriptList.querySelectorAll('.cue-item').forEach((n) => n.remove());
    if (!state.cues.length) {
      el.transcriptEmpty.style.display = '';
      return;
    }
    el.transcriptEmpty.style.display = 'none';
    state.cues.forEach((cue, idx) => {
      const item = document.createElement('div');
      item.className = 'cue-item';
      item.setAttribute('role', 'listitem');
      item.setAttribute('data-index', String(idx));
      const t = document.createElement('span');
      t.className = 'cue-time';
      t.textContent = formatTime(cue.start);
      const text = document.createElement('span');
      text.className = 'cue-text';
      text.innerHTML = cue.html;
      item.appendChild(t);
      item.appendChild(text);
      item.addEventListener('click', () => {
        state.audio.currentTime = cue.start;
        if (state.audioReady) state.audio.play().catch(() => {});
      });
      el.transcriptList.appendChild(item);
    });
  }

  function applySubtitle(cues, name) {
    state.cues = cues;
    state.activeIndex = -1;
    renderTranscript();
    el.subtitleLine.textContent = '字幕已载入，播放时同步显示';
    el.subtitleLine.classList.add('is-empty');
    setStatus(`字幕已载入 · ${cues.length} 条`, 'ok');
    updateRecord();
  }

  async function loadSubtitle(source) {
    try {
      const res = await fetch(source.url);
      if (!res.ok) throw new Error('读取失败 ' + res.status);
      const text = await res.text();
      const cues = window.VTT.parse(text);
      applySubtitle(cues, source.name);
    } catch (err) {
      console.error(err);
      setStatus('字幕载入失败', 'warn');
    }
  }

  async function tryAutoSubtitle(audioPath) {
    if (!audioPath) return;
    try {
      const found = await api.findSubtitle(audioPath);
      if (!found) return;
      const url = found.url;
      const res = await fetch(url);
      if (!res.ok) return;
      const text = await res.text();
      const cues = window.VTT.parse(text);
      if (cues.length) {
        applySubtitle(cues, found.name);
        setStatus(`已自动搜索到字幕 · ${cues.length} 条`, 'ok');
      }
    } catch (_err) {
      /* no matching subtitle found */
    }
  }

  // ---------- transport ----------
  function updateTransportDisabled(disabled) {
    [el.btnStart, el.btnBack, el.btnPlay, el.btnFwd, el.btnEnd, el.seekBar].forEach((b) => {
      b.disabled = disabled;
    });
  }
  updateTransportDisabled(true);

  function togglePlay() {
    if (!state.audioReady) return;
    if (state.audio.paused) state.audio.play().catch(() => {});
    else state.audio.pause();
  }

  function seekBy(delta) {
    if (!state.audioReady) return;
    const dur = currentDuration();
    if (!isFinite(dur)) return;
    state.audio.currentTime = clamp(state.audio.currentTime + delta, 0, dur);
  }

  function setVolume(delta) {
    const next = clamp(state.audio.volume + delta, 0, 1);
    state.audio.volume = next;
    state.audio.muted = false;
    el.volBar.value = String(next);
    updateVolIcon();
  }

  function updateVolIcon() {
    el.volIcon.textContent = state.audio.muted ? 'mute' : state.audio.volume === 0 ? 'mute' : 'vol';
  }

  function toggleMute() {
    state.audio.muted = !state.audio.muted;
    updateVolIcon();
  }

  function toggleLoop() {
    state.loop = !state.loop;
    state.audio.loop = state.loop;
    el.btnLoop.classList.toggle('is-on', state.loop);
    setStatus(state.loop ? '单曲循环：开' : '单曲循环：关');
  }

  function cycleSpeed() {
    state.speedPos = (state.speedPos + 1) % SPEEDS.length;
    const speed = SPEEDS[state.speedPos];
    state.audio.playbackRate = speed;
    el.btnSpeed.textContent = speed.toFixed(speed % 1 ? 2 : 1).replace(/\.00$/, '') + '×';
    setStatus(`播放速度 ${speed}×`);
  }

  function setAB() {
    const ab = state.ab;
    if (!ab.on) {
      if (ab.a === null) {
        ab.a = state.audio.currentTime;
        setStatus(`A 点已标记 ${formatTime(ab.a)}`);
      } else {
        ab.b = state.audio.currentTime;
        if (ab.b <= ab.a + 0.05) ab.b = currentDuration();
        ab.on = true;
        setStatus(`A-B 循环 ${formatTime(ab.a)} → ${formatTime(ab.b)}`);
      }
    } else {
      ab.on = false;
      ab.a = null;
      ab.b = null;
      setStatus('A-B 循环已关闭');
    }
    updateAbUI();
  }

  function updateAbUI() {
    const ab = state.ab;
    const dur = currentDuration();
    const pct = (t) => (dur ? clamp(t / dur, 0, 1) * 100 : 0);
    el.btnAB.classList.toggle('is-on', ab.on);
    if (ab.a !== null) {
      el.abA.style.left = pct(ab.a) + '%';
      el.abA.hidden = false;
    } else {
      el.abA.hidden = true;
    }
    if (ab.b !== null) {
      el.abB.style.left = pct(ab.b) + '%';
      el.abB.hidden = false;
    } else {
      el.abB.hidden = true;
    }
  }

  function updateTransport() {
    const dur = currentDuration();
    el.timeTotal.textContent = formatTime(dur);
    if (!state.audioReady) updateTransportDisabled(true);
  }

  el.btnPlay.addEventListener('click', togglePlay);
  el.btnStart.addEventListener('click', prevTrack);
  el.btnEnd.addEventListener('click', nextTrack);
  el.btnBack.addEventListener('click', () => seekBy(-5));
  el.btnFwd.addEventListener('click', () => seekBy(5));
  el.btnAB.addEventListener('click', setAB);
  el.btnLoop.addEventListener('click', toggleLoop);
  el.btnSpeed.addEventListener('click', cycleSpeed);
  el.btnMute.addEventListener('click', toggleMute);
  el.volBar.addEventListener('input', () => {
    state.audio.volume = parseFloat(el.volBar.value);
    state.audio.muted = state.audio.volume === 0;
    updateVolIcon();
  });
  el.seekBar.addEventListener('input', () => {
    const dur = state.audio.duration || state.duration || 0;
    if (!dur) return;
    state.audio.currentTime = (parseInt(el.seekBar.value, 10) / 1000) * dur;
  });

  state.audio.addEventListener('play', () => {
    state.isPlaying = true;
    el.btnPlay.classList.add('is-playing');
    el.btnPlay.setAttribute('aria-label', '暂停');
  });
  state.audio.addEventListener('pause', () => {
    state.isPlaying = false;
    el.btnPlay.classList.remove('is-playing');
    el.btnPlay.setAttribute('aria-label', '播放');
  });
  state.audio.addEventListener('loadedmetadata', updateTransport);
  state.audio.addEventListener('durationchange', updateTransport);
  state.audio.addEventListener('ended', () => {
    if (!state.loop && !state.ab.on) el.btnPlay.classList.remove('is-playing');
  });
  state.audio.addEventListener('error', () => {
    if (state.audio.src) setStatus('无法播放此文件', 'warn');
  });

  // ---------- waveform seek ----------
  let waveDragging = false;

  function wavePointToTime(clientX) {
    const rect = el.waveWrap.getBoundingClientRect();
    const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
    const dur = currentDuration();
    return frac * dur;
  }

  el.waveWrap.addEventListener('pointerdown', (e) => {
    if (!state.audioReady) return;
    waveDragging = true;
    try { el.waveWrap.setPointerCapture(e.pointerId); } catch (_err) {}
    state.audio.currentTime = wavePointToTime(e.clientX);
  });
  el.waveWrap.addEventListener('pointermove', (e) => {
    if (waveDragging) state.audio.currentTime = wavePointToTime(e.clientX);
  });
  el.waveWrap.addEventListener('pointerup', (e) => {
    waveDragging = false;
    try { el.waveWrap.releasePointerCapture(e.pointerId); } catch (_err) {}
  });
  el.waveWrap.addEventListener('pointercancel', () => { waveDragging = false; });
  el.waveWrap.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5); }
    else if (e.key === 'Home') { e.preventDefault(); state.audio.currentTime = 0; }
    else if (e.key === 'End') {
      e.preventDefault();
      const dur = state.audio.duration || state.duration;
      if (dur) state.audio.currentTime = dur;
    }
  });

  // ---------- progress / cue sync ----------
  const waveClipRect = () => document.getElementById('waveClipRect');

  function findCueIndex(time) {
    const cues = state.cues;
    if (!cues.length) return -1;
    let lo = 0;
    let hi = cues.length - 1;
    let res = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (cues[m].start <= time) {
        res = m;
        lo = m + 1;
      } else {
        hi = m - 1;
      }
    }
    if (res >= 0 && time < cues[res].end) return res;
    return -1;
  }

  function updateSubtitle() {
    const cue = state.cues[state.activeIndex];
    if (cue) {
      el.subtitleLine.innerHTML = cue.html;
      el.subtitleLine.classList.remove('is-empty');
    } else {
      el.subtitleLine.textContent = state.cues.length ? '——' : '字幕将在此同步显示';
      el.subtitleLine.classList.add('is-empty');
    }
  }

  function updateTranscriptActive() {
    const items = el.transcriptList.querySelectorAll('.cue-item');
    items.forEach((item, index) => {
      const active = index === state.activeIndex;
      item.classList.toggle('is-active', active);
      if (active && state.isPlaying) {
        item.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    });
  }

  function setProgress(time) {
    const dur = currentDuration();
    const pct = dur ? clamp(time / dur, 0, 1) : 0;
    const rect = waveClipRect();
    if (rect && state.peaks) {
      rect.setAttribute('width', (pct * state.peaks.length * SLOT).toFixed(2));
    }
    el.playhead.style.left = pct * 100 + '%';
    el.seekBar.value = String(Math.floor(pct * 1000));
    el.seekBar.style.setProperty('--fill', pct * 100 + '%');
    el.timeCurrent.textContent = formatTime(time);
  }

  let lastDurationTick = -1;

  function frame() {
    const audio = state.audio;
    const t = audio.currentTime;
    if (state.audioReady) {
      const rounded = Math.round(currentDuration() * 10);
      if (rounded !== lastDurationTick) {
        lastDurationTick = rounded;
        updateTransport();
      }
      setProgress(t);
      const idx = findCueIndex(t);
      if (idx !== state.activeIndex) {
        state.activeIndex = idx;
        updateSubtitle();
        updateTranscriptActive();
      }
      if (state.ab.on && state.ab.b !== null && !audio.paused && t >= state.ab.b) {
        audio.currentTime = state.ab.a || 0;
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- record panel ----------
  function updateRecord() {
    const meta = state.wavMeta;
    const fmtName = meta ? (meta.audioFormat === 3 ? 'FLOAT' : meta.audioFormat === 1 ? 'PCM' : 'WAV') : extOf(state.audioName).toUpperCase() || '—';
    const chStr = state.channels === 2 ? '立体声 (2ch)' : state.channels === 1 ? '单声道 (1ch)' : state.channels ? `${state.channels}ch` : '—';
    const rows = [
      ['文件', state.audioName || '—', true],
      ['格式', fmtName, true],
      ['时长', formatTime(state.duration), true],
      ['采样率', state.sampleRate ? state.sampleRate.toLocaleString() + ' Hz' : '—', true],
      ['声道', chStr, true],
      ['位深', state.bits ? state.bits + ' bit' : '—', true],
      ['大小', formatSize(state.size), true],
      ['字幕', state.cues.length ? state.cues.length + ' 条' : '未加载', false],
    ];
    el.recordDetails.innerHTML = rows
      .map(
        ([dt, dd, mono]) =>
          `<div><dt>${dt}</dt><dd class="${mono ? 'mono' : ''}">${dd}</dd></div>`
      )
      .join('');
  }

  // ---------- transcribe (JP -> ZH) ----------
  const TRANSCRIBE_REPO = 'chickenrice0721/whisper-large-v2-translate-zh-v0.2-st-ct2';

  function tstate() {
    return state.transcribe;
  }

  function persistTranscribe() {
    try {
      localStorage.setItem(
        'resonance.transcribe',
        JSON.stringify({
          modelSource: tstate().modelSource,
          modelDir: tstate().modelDir,
          device: tstate().device,
          compute: tstate().compute,
        })
      );
    } catch (_e) {
      /* ignore */
    }
  }

  function loadTranscribePrefs() {
    try {
      const raw = localStorage.getItem('resonance.transcribe');
      if (!raw) return;
      const p = JSON.parse(raw) || {};
      if (p.modelSource) tstate().modelSource = p.modelSource;
      if (p.modelDir) tstate().modelDir = p.modelDir;
      if (p.device) tstate().device = p.device;
      if (p.compute) tstate().compute = p.compute;
    } catch (_e) {
      /* ignore */
    }
  }

  function updateTranscribeModelHint() {
    const t = tstate();
    if (t.modelSource === 'local') {
      el.transcribeModelHint.textContent = t.modelDir || '尚未选择本地模型目录';
    } else {
      el.transcribeModelHint.textContent = '将下载 ' + TRANSCRIBE_REPO + ' 日→中优化模型。';
    }
  }

  function setTranscribeStatus(text, warn) {
    el.transcribeStatus.textContent = text || '';
    el.transcribeStatus.hidden = !text;
    el.transcribeStatus.classList.toggle('is-warn', !!warn);
  }

  function setTranscribeProgress(percent) {
    const pct = clamp(removeNaN(percent, 0), 0, 100);
    el.transcribeBar.style.setProperty('--bar-fill', pct + '%');
    el.transcribePct.textContent = Math.round(pct) + '%';
    tstate().progress = pct;
  }

  function removeNaN(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  async function detectEnvAndShow() {
    const env = await api.transcribeEnv();
    tstate().env = env;
    el.transcribeEnvNote.hidden = false;
    if (!env) {
      el.transcribeEnvNote.classList.add('is-warn');
      el.transcribeEnvNote.textContent = '未找到带 faster-whisper 的 Python 环境。请安装 Python 3.11 并执行 pip install faster-whisper。';
      return;
    }
    if (!env.ok) {
      el.transcribeEnvNote.classList.add('is-warn');
      el.transcribeEnvNote.textContent = '缺少依赖: ' + (env.missing || []).join(', ') + '。请执行 pip install faster-whisper。';
      return;
    }
    el.transcribeEnvNote.classList.remove('is-warn');
    const gpu = env.cuda_devices > 0;
    el.transcribeEnvNote.textContent =
      (gpu ? 'GPU 可用 · CUDA ' + env.cuda_devices + ' 设备' : '未检测到 GPU · 将使用 CPU') +
      ' · Python ' + env.version + ' · faster-whisper ' + env.faster_whisper;
  }

  function buildTranscribeConfig() {
    const t = tstate();
    return {
      audio: state.audioPath,
      model_dir: t.modelSource === 'download' ? TRANSCRIBE_REPO : t.modelDir,
      allow_download: t.modelSource === 'download',
      output: state.audioPath + '.zh.vtt',
      format: 'vtt',
      device: t.device,
      compute_type: t.compute,
      language: 'ja',
      task: 'translate',
      beam_size: 5,
      vad_filter: false,
    };
  }

  async function startTranscribe() {
    const t = tstate();
    if (!state.audioPath) {
      setStatus('请先加载要转写的音频', 'warn');
      return;
    }
    if (t.running) return;
    const config = buildTranscribeConfig();
    if (t.modelSource === 'local' && !t.modelDir) {
      setStatus('请先选择本地模型目录', 'warn');
      setTranscribeStatus('请先选择本地模型目录', true);
      return;
    }
    setTranscribeProgress(0);
    setTranscribeStatus('正在启动转写…');
    el.transcribeSegment.hidden = true;
    const res = await api.transcribeStart('transcribe', config);
    if (!res || res.error) {
      const msg = (res && res.message) || '无法启动转写';
      setStatus('转写启动失败: ' + msg, 'warn');
      setTranscribeStatus('失败: ' + msg, true);
      return;
    }
    t.jobId = res.jobId;
    t.running = true;
    el.transcribeStart.disabled = true;
    el.transcribeCancel.hidden = false;
    el.btnTranscribe.classList.add('is-on');
  }

  async function cancelTranscribe() {
    const t = tstate();
    if (!t.jobId) return;
    await api.transcribeCancel(t.jobId);
    setTranscribeStatus('已取消', true);
    endTranscribeUi();
  }

  function endTranscribeUi() {
    const t = tstate();
    t.running = false;
    t.jobId = null;
    el.transcribeStart.disabled = false;
    el.transcribeCancel.hidden = true;
    el.btnTranscribe.classList.remove('is-on');
  }

  async function onTranscribeDone(evt) {
    const output = evt.output;
    setTranscribeProgress(100);
    setTranscribeStatus('完成 · ' + (evt.count || 0) + ' 条字幕 · ' + (evt.elapsed || 0) + 's');
    setStatus('转写完成 · ' + (evt.count || 0) + ' 条字幕', 'ok');
    endTranscribeUi();
    if (output) {
      try {
        const url = await api.registerPath(output);
        await loadSubtitle({ url, path: output, name: basename(output) });
        const idx = state.currentIndex;
        if (idx >= 0 && state.playlist[idx]) {
          state.playlist[idx].subPath = output;
          state.playlist[idx].subUrl = url;
          state.playlist[idx].subName = basename(output);
          renderPlaylist();
        }
      } catch (_err) {
        setStatus('已生成字幕, 但自动载入失败', 'warn');
      }
    }
  }

  function onTranscribeEvent(evt) {
    if (!evt || evt.jobId !== tstate().jobId) return;
    switch (evt.type) {
      case 'started':
        break;
      case 'status':
        setTranscribeStatus((evt.message || '') + (evt.detail ? ' · ' + evt.detail : ''));
        break;
      case 'progress': {
        let pct = removeNaN(evt.percent, 0);
        if (!pct && evt.total) pct = (evt.completed / evt.total) * 100;
        if (evt.what === 'download') {
          setTranscribeStatus('正在下载模型' + (evt.file ? ' · ' + evt.file : ''));
        } else if (evt.completed != null && evt.total) {
          setTranscribeStatus('转写进行中 · ' + Math.round(pct) + '%');
        }
        setTranscribeProgress(pct);
        break;
      }
      case 'segment':
        el.transcribeSegment.hidden = false;
        el.transcribeSegment.textContent = evt.text || '';
        break;
      case 'done':
        onTranscribeDone(evt);
        break;
      case 'error':
        setStatus('转写失败: ' + evt.message, 'warn');
        setTranscribeStatus('失败: ' + evt.message, true);
        endTranscribeUi();
        break;
      case 'cancelled':
        endTranscribeUi();
        break;
      default:
        break;
    }
  }

  function openTranscribe() {
    if (!state.audioPath) {
      setStatus('请先加载要转写的音频', 'warn');
      return;
    }
    el.transcribeModal.hidden = false;
    el.transcribeModel.value = tstate().modelSource;
    el.transcribeDevice.value = tstate().device;
    el.transcribeCompute.value = tstate().compute;
    updateTranscribeModelHint();
    setTranscribeProgress(tstate().progress);
    setTranscribeStatus(tstate().running ? '转写进行中…' : '');
    el.transcribeSegment.hidden = true;
    if (!tstate().running) detectEnvAndShow();
  }

  function closeTranscribe() {
    if (tstate().running) {
      setStatus('转写仍在进行, 请先取消', 'warn');
      return;
    }
    el.transcribeModal.hidden = true;
  }

  el.btnTranscribe.addEventListener('click', openTranscribe);
  el.transcribeClose.addEventListener('click', closeTranscribe);
  el.transcribeStart.addEventListener('click', startTranscribe);
  el.transcribeCancel.addEventListener('click', cancelTranscribe);
  el.transcribeModel.addEventListener('change', () => {
    tstate().modelSource = el.transcribeModel.value;
    updateTranscribeModelHint();
    persistTranscribe();
  });
  el.transcribeBrowse.addEventListener('click', async () => {
    const dir = await api.transcribePickModelDir();
    if (dir) {
      tstate().modelDir = dir;
      tstate().modelSource = 'local';
      el.transcribeModel.value = 'local';
      updateTranscribeModelHint();
      persistTranscribe();
    }
  });
  el.transcribeDevice.addEventListener('change', () => {
    tstate().device = el.transcribeDevice.value;
    persistTranscribe();
  });
  el.transcribeCompute.addEventListener('change', () => {
    tstate().compute = el.transcribeCompute.value;
    persistTranscribe();
  });
  api.onTranscribeEvent(onTranscribeEvent);
  api.onMenuTranscribe(openTranscribe);
  loadTranscribePrefs();
  updateTranscribeModelHint();

  // ---------- drag and drop ----------
  function resolveSource(fileOrPath) {
    if (typeof fileOrPath === 'string') {
      return api.registerPath(fileOrPath).then((url) => ({
        url,
        path: fileOrPath,
        name: basename(fileOrPath),
      }));
    }
    // File object
    const p = api.getPathForFile(fileOrPath);
    if (p) {
      return api.registerPath(p).then((url) => ({
        url,
        path: p,
        name: fileOrPath.name || basename(p),
      }));
    }
    // Browser fallback: blob URL
    return Promise.resolve({
      url: URL.createObjectURL(fileOrPath),
      path: '',
      name: fileOrPath.name,
    });
  }

  function handleDropped(file) {
    const ext = extOf(file.name || file);
    if (AUDIO_EXT.includes(ext)) {
      resolveSource(file).then((source) => {
        playSingle(source);
      });
    } else if (SUB_EXT.includes(ext)) {
      resolveSource(file).then((source) => {
        if (ext === 'srt') {
          // Re-encode SRT text to VTT cues via parser; parser already accepts SRT.
          loadSubtitle(source);
        } else {
          loadSubtitle(source);
        }
      });
    } else if (IMAGE_EXT.includes(ext)) {
      resolveSource(file).then((source) => {
        setCustomCover(source);
      });
    } else {
      setStatus('不支持的格式：' + ext, 'warn');
    }
  }

  let dragDepth = 0;
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth += 1;
    document.body.classList.add('is-dragging');
  });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove('is-dragging');
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    for (const file of Array.from(files)) handleDropped(file);
  });

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    const isInteractive = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag);
    switch (e.key) {
      case ' ':
        if (isInteractive) return;
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        if (isInteractive) return;
        e.preventDefault();
        seekBy(5);
        break;
      case 'ArrowLeft':
        if (isInteractive) return;
        e.preventDefault();
        seekBy(-5);
        break;
      case 'ArrowUp':
        if (isInteractive) return;
        e.preventDefault();
        setVolume(0.05);
        break;
      case 'ArrowDown':
        if (isInteractive) return;
        e.preventDefault();
        setVolume(-0.05);
        break;
      case 'm':
      case 'M':
        toggleMute();
        break;
      case 'l':
      case 'L':
        toggleLoop();
        break;
      case 'a':
      case 'A':
        setAB();
        break;
      case 'Home':
        e.preventDefault();
        state.audio.currentTime = 0;
        break;
      case 'End':
        e.preventDefault();
        {
          const dur = currentDuration();
          if (dur) state.audio.currentTime = dur;
        }
        break;
      case 'Escape':
        if (!el.transcribeModal.hidden) closeTranscribe();
        break;
      case 'PageUp':
        e.preventDefault();
        prevTrack();
        break;
      case 'PageDown':
        e.preventDefault();
        nextTrack();
        break;
      default:
        break;
    }
  });

  // ---------- resizable archive width ----------
  const ARCHIVE_W_KEY = 'resonance.archiveWidth';
  const ARCHIVE_MIN = 280;
  const ARCHIVE_DEFAULT = 21 * 16;

  function clampArchiveW(w, maxW) {
    let v = Math.round(w);
    if (!isFinite(v) || v < ARCHIVE_MIN) v = ARCHIVE_MIN;
    if (isFinite(maxW) && v > maxW) v = Math.round(maxW);
    return v;
  }

  function setArchiveWidth(w) {
    el.stage.style.setProperty('--archive-w', w + 'px');
  }

  function commitArchiveWidth(w) {
    try {
      localStorage.setItem(ARCHIVE_W_KEY, String(w));
    } catch (_e) {
      /* ignore */
    }
  }

  function maxArchiveW() {
    return Math.min(Math.round(el.stage.clientWidth * 0.62), 640);
  }

  function resetArchiveWidth() {
    setArchiveWidth(ARCHIVE_DEFAULT);
    commitArchiveWidth(ARCHIVE_DEFAULT);
    setStatus('已重置侧栏宽度');
  }

  const savedW = Number.parseFloat(localStorage.getItem(ARCHIVE_W_KEY));
  if (savedW > 0) setArchiveWidth(clampArchiveW(savedW, maxArchiveW() || Infinity));

  let resizing = false;
  const currentArchiveW = () => {
    const raw = parseFloat(getComputedStyle(el.stage).getPropertyValue('--archive-w'));
    return isFinite(raw) && raw > 0 ? raw : ARCHIVE_DEFAULT;
  };

  el.resizer.addEventListener('pointerdown', (e) => {
    resizing = true;
    el.resizer.classList.add('is-dragging');
    document.body.style.userSelect = 'none';
    try {
      el.resizer.setPointerCapture(e.pointerId);
    } catch (_e) {
      /* ignore */
    }
    e.preventDefault();
  });

  el.resizer.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const rect = el.stage.getBoundingClientRect();
    setArchiveWidth(clampArchiveW(rect.right - e.clientX, maxArchiveW()));
  });

  el.resizer.addEventListener('pointerup', (e) => {
    if (!resizing) return;
    resizing = false;
    el.resizer.classList.remove('is-dragging');
    document.body.style.userSelect = '';
    const rect = el.stage.getBoundingClientRect();
    const w = clampArchiveW(rect.right - e.clientX, maxArchiveW());
    setArchiveWidth(w);
    commitArchiveWidth(w);
  });

  el.resizer.addEventListener('pointercancel', () => {
    resizing = false;
    el.resizer.classList.remove('is-dragging');
    document.body.style.userSelect = '';
  });

  el.resizer.addEventListener('dblclick', resetArchiveWidth);
  el.resizer.addEventListener('keydown', (e) => {
    let next;
    if (e.key === 'ArrowLeft') next = clampArchiveW(currentArchiveW() - 16, maxArchiveW());
    else if (e.key === 'ArrowRight') next = clampArchiveW(currentArchiveW() + 16, maxArchiveW());
    else if (e.key === 'Home') {
      e.preventDefault();
      resetArchiveWidth();
      return;
    } else return;
    e.preventDefault();
    setArchiveWidth(next);
    commitArchiveWidth(next);
  });

  // ---------- init ----------
  updateVolIcon();
  updateAbUI();
  setView('list');
  requestAnimationFrame(frame);

  // QA-only facade, activated with ?qa=1. Never present in the packaged app.
  if (new URLSearchParams(location.search).has('qa')) {
    window.__qa = {
      loadAudioPath: (p) =>
        api.registerPath(p).then((url) => loadAudio({ url, path: p, name: basename(p) })),
      loadSubtitlePath: (p) =>
        api.registerPath(p).then((url) => loadSubtitle({ url, path: p, name: basename(p) })),
      setView,
      togglePlay,
      coverPath: (p) => api.registerPath(p).then((url) => setCustomCover({ url, path: p, kind: 'custom' })),
      clearCover,
      loadFolderPath: (p) =>
        api.scanFolder(p).then((lib) => {
          if (!lib || !lib.tracks.length) return 0;
          state.playlist = lib.tracks;
          state.folderName = lib.name;
          setView('list');
          renderPlaylist();
          loadTrack(0);
          return lib.tracks.length;
        }),
      playTrack: (index) => loadTrack(index),
      setArchiveW: (w) => setArchiveWidth(clampArchiveW(w, maxArchiveW() || Infinity)),
      dragArchive: (clientX) => {
        const w = clampArchiveW(el.stage.getBoundingClientRect().right - clientX, maxArchiveW());
        setArchiveWidth(w);
        commitArchiveWidth(w);
        return w;
      },
      archiveWidth: () => currentArchiveW(),
      transcribe: {
        open: openTranscribe,
        close: closeTranscribe,
        start: startTranscribe,
        cancel: cancelTranscribe,
        event: onTranscribeEvent,
        detectEnv: detectEnvAndShow,
        setEnv: (env) => {
          tstate().env = env;
        },
        beginFake: (jobId) => {
          const t = tstate();
          t.jobId = jobId || 'qa-job';
          t.running = true;
          el.transcribeStart.disabled = true;
          el.transcribeCancel.hidden = false;
          el.btnTranscribe.classList.add('is-on');
        },
        state: () => tstate(),
      },
      state,
      api,
    };
  }
})();
