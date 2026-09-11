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
    setFolderCover: async () => false,
    clearFolderCover: async () => false,
    folderCover: async () => null,
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
    folderPath: '',
    pendingResume: 0,
    albums: [],
    albumPreview: null,
    transcribe: {
      jobId: null,
      running: false,
      modelSource: 'download',
      modelDir: '',
      device: 'auto',
      compute: 'auto',
      scope: 'current',
      format: 'vtt',
      vad: false,
      skipExisting: true,
      progress: 0,
      statusMsg: '',
      env: null,
      queue: [],
      filesTotal: 0,
      filesDone: 0,
      fileIndex: -1,
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
    subLinePrev: $('#subLinePrev'),
    subLineNext: $('#subLineNext'),
    subtitleRoll: $('#subtitleRoll'),
    subProgressTrack: $('#subProgressTrack'),
    subProgress: $('#subProgress'),
    autoScrollBtn: $('#autoScrollBtn'),
    scrollReturn: $('#scrollReturn'),
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
    transcribeScope: $('#transcribeScope'),
    transcribeFormat: $('#transcribeFormat'),
    transcribeVad: $('#transcribeVad'),
    transcribeSkip: $('#transcribeSkip'),
    transcribeQueue: $('#transcribeQueue'),
    transcribeQueueList: $('#transcribeQueueList'),
    transcribeQueueStat: $('#transcribeQueueStat'),
    transcribeScopeNote: $('#transcribeScopeNote'),
    albumList: $('#albumList'),
    albumEmpty: $('#albumEmpty'),
    addAlbumBtn: $('#addAlbumBtn'),
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

  // ---------- persistent storage ----------
  const STORE = {
    session: 'wavplayer.session',
    positions: 'wavplayer.positions',
    albums: 'wavplayer.albums',
    transcribe: 'wavplayer.transcribe',
    archiveW: 'wavplayer.archiveWidth',
    autoScroll: 'wavplayer.autoScroll',
  };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const value = JSON.parse(raw);
      return value == null ? fallback : value;
    } catch (_e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_e) {
      /* ignore */
    }
  }

  // ---------- session / playback positions ----------
  let positions = loadJSON(STORE.positions, {});
  let posDirty = false;
  let lastPosTick = 0;

  function persistPositions() {
    if (!posDirty) return;
    posDirty = false;
    const keys = Object.keys(positions);
    if (keys.length > 800) {
      keys
        .sort((a, b) => (positions[a].at || 0) - (positions[b].at || 0))
        .slice(0, keys.length - 600)
        .forEach((k) => delete positions[k]);
    }
    saveJSON(STORE.positions, positions);
  }

  function savePosition(path, seconds) {
    if (!path) return;
    if (!isFinite(seconds) || seconds < 3) delete positions[path];
    else positions[path] = { t: Math.round(seconds), at: Date.now() };
    posDirty = true;
  }

  function getSavedPosition(path) {
    const hit = path ? positions[path] : null;
    return hit && typeof hit.t === 'number' && hit.t > 3 ? hit.t : 0;
  }

  function saveSession() {
    saveJSON(STORE.session, {
      folderPath: state.folderPath || '',
      currentIndex: state.currentIndex,
      currentTime: state.audio.currentTime || 0,
      savedAt: Date.now(),
    });
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORE.session);
    } catch (_e) {
      /* ignore */
    }
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
    $('#panelAlbums').hidden = view !== 'albums';
    if (view === 'record') updateRecord();
    if (view === 'albums') renderAlbums();
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

      const thumb = document.createElement('span');
      thumb.className = 'pl-thumb' + (track.coverUrl ? ' has' : '');
      if (track.coverUrl) thumb.style.backgroundImage = `url("${track.coverUrl}")`;
      else thumb.textContent = '♪';

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
      item.appendChild(thumb);
      item.appendChild(main);
      item.appendChild(meta);
      item.addEventListener('click', () => loadTrack(index));
      el.playlistList.appendChild(item);
    });
    resolvePlaylistCovers();
  }

  // 懒加载: 为缺少封面文件的曲目解析内嵌封面 (限量, 避免卡顿)
  let coverResolveRunning = false;

  function updatePlaylistRow(index) {
    const row = el.playlistList.querySelector(`.pl-item[data-index="${index}"]`);
    const track = state.playlist[index];
    if (!row || !track) return;
    const thumb = row.querySelector('.pl-thumb');
    if (thumb && track.coverUrl) {
      thumb.classList.add('has');
      thumb.style.backgroundImage = `url("${track.coverUrl}")`;
      thumb.textContent = '';
    }
    const badges = row.querySelector('.pl-badges');
    if (badges && track.coverUrl && !badges.querySelector('.is-cover')) {
      const cb = document.createElement('span');
      cb.className = 'pl-badge is-cover';
      cb.textContent = '封面';
      badges.appendChild(cb);
    }
  }

  async function resolvePlaylistCovers() {
    if (coverResolveRunning) return;
    coverResolveRunning = true;
    let budget = 150;
    try {
      for (let i = 0; i < state.playlist.length && budget > 0; i++) {
        const track = state.playlist[i];
        if (track.coverUrl || track.coverResolved) continue;
        track.coverResolved = true;
        budget -= 1;
        try {
          const found = await api.findCover(track.path);
          if (found && found.url) {
            track.coverUrl = found.url;
            track.coverPath = found.path || '';
            track.coverKind = found.kind || 'auto';
            updatePlaylistRow(i);
          }
        } catch (_e) {
          /* ignore individual failures */
        }
      }
    } finally {
      coverResolveRunning = false;
    }
  }

  function loadTrack(index, autoplay) {
    if (index < 0 || index >= state.playlist.length) return;
    const track = state.playlist[index];
    state.currentIndex = index;
    loadAudio(
      { url: track.url, path: track.path, name: track.name },
      track,
      autoplay != null ? autoplay : !state.audio.paused
    );
    renderPlaylist();
    saveSession();
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

  // 把扫描结果应用到界面 (播放列表 / 专辑 / 封面)
  function applyLibrary(lib, opts) {
    const options = opts || {};
    state.playlist = lib.tracks || [];
    state.folderName = lib.name || '';
    state.folderPath = lib.folderPath || '';
    state.currentIndex = -1;
    upsertAlbum({
      path: state.folderPath,
      name: state.folderName,
      coverPath: lib.folderCover || '',
      coverUrl: lib.folderCoverUrl || '',
      trackCount: state.playlist.length,
      touch: true,
    });
    renderPlaylist();
    renderAlbums();
    updateScopeNote();
    if (!options.noLoad && state.playlist.length) loadTrack(0, options.autoplay);
  }

  async function openFolderPath(folderPath, opts) {
    const options = opts || {};
    if (!folderPath) return false;
    setStatus('正在扫描文件夹…', 'ok');
    const library = await api.scanFolder(folderPath);
    if (!library || !library.tracks.length) {
      setStatus('该文件夹没有可播放的音频', 'warn');
      return false;
    }
    applyLibrary(library, { noLoad: true });
    setView('list');
    setStatus(`已载入 ${library.tracks.length} 个音频`, 'ok');
    const index = options.index != null ? clamp(options.index, 0, library.tracks.length - 1) : 0;
    loadTrack(index, options.autoplay === true);
    return true;
  }

  async function loadFolder() {
    const folderPath = await api.openFolder();
    if (!folderPath) return;
    await openFolderPath(folderPath, { autoplay: true });
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

  // ---------- albums (专辑文件夹管理) ----------
  state.albums = loadJSON(STORE.albums, []);

  function saveAlbums() {
    saveJSON(STORE.albums, state.albums);
  }

  function upsertAlbum(entry) {
    if (!entry || !entry.path) return;
    const idx = state.albums.findIndex((a) => a.path === entry.path);
    const prev = idx >= 0 ? state.albums[idx] : {};
    const next = {
      path: entry.path,
      name: entry.name || prev.name || basename(entry.path),
      coverPath: entry.coverPath || prev.coverPath || '',
      coverUrl: entry.coverUrl || prev.coverUrl || '',
      trackCount: entry.trackCount != null ? entry.trackCount : prev.trackCount || 0,
      addedAt: prev.addedAt || Date.now(),
      openedAt: entry.touch ? Date.now() : prev.openedAt || Date.now(),
    };
    if (idx >= 0) state.albums[idx] = next;
    else state.albums.push(next);
    saveAlbums();
  }

  function removeAlbum(path) {
    state.albums = state.albums.filter((a) => a.path !== path);
    saveAlbums();
    renderAlbums();
    setStatus('已从专辑列表移除（不删除文件）', 'warn');
  }

  function renderAlbums() {
    const list = el.albumList;
    list.querySelectorAll('.album-card, .album-preview').forEach((n) => n.remove());
    if (!state.albums.length) {
      el.albumEmpty.style.display = '';
      return;
    }
    el.albumEmpty.style.display = 'none';
    let previewRendered = false;
    state.albums
      .slice()
      .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))
      .forEach((album) => {
        const card = document.createElement('div');
        card.className = 'album-card' + (album.path === state.folderPath ? ' is-active' : '');
        card.setAttribute('role', 'listitem');
        card.setAttribute('data-album', album.path);
        card.tabIndex = 0;

        const cover = document.createElement('span');
        cover.className = 'album-cover';
        if (album.coverUrl) cover.style.backgroundImage = `url("${album.coverUrl}")`;
        else cover.textContent = '♪';

        const info = document.createElement('span');
        info.className = 'album-info';
        const nm = document.createElement('span');
        nm.className = 'album-name';
        nm.textContent = album.name || basename(album.path);
        const mt = document.createElement('span');
        mt.className = 'album-meta';
        mt.textContent = `${album.trackCount || 0} 首 · ${album.path}`;
        info.appendChild(nm);
        info.appendChild(mt);

        const btns = document.createElement('span');
        btns.className = 'album-btns';
        const coverBtn = document.createElement('button');
        coverBtn.className = 'album-btn';
        coverBtn.type = 'button';
        coverBtn.title = '设置专辑封面';
        coverBtn.setAttribute('aria-label', '设置专辑封面');
        coverBtn.textContent = '封';
        coverBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          chooseAlbumCover(album);
        });
        const rmBtn = document.createElement('button');
        rmBtn.className = 'album-btn';
        rmBtn.type = 'button';
        rmBtn.title = '从列表移除';
        rmBtn.setAttribute('aria-label', '从列表移除');
        rmBtn.textContent = '✕';
        rmBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeAlbum(album.path);
        });
        btns.appendChild(coverBtn);
        btns.appendChild(rmBtn);

        card.appendChild(cover);
        card.appendChild(info);
        card.appendChild(btns);
        card.addEventListener('click', () => previewAlbum(album));
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            previewAlbum(album);
          }
        });
        list.appendChild(card);
        if (state.albumPreview && state.albumPreview.path === album.path) {
          list.appendChild(buildAlbumPreview());
          previewRendered = true;
        }
      });
    if (state.albumPreview && !previewRendered) list.appendChild(buildAlbumPreview());
    resolveAlbumCovers();
  }

  // 预览区块 (只读, 不改变当前播放)
  function buildAlbumPreview() {
    const pv = state.albumPreview;
    const box = document.createElement('div');
    box.className = 'album-preview';
    box.setAttribute('data-album-preview', pv.path);

    const head = document.createElement('div');
    head.className = 'album-preview-head';
    const code = document.createElement('span');
    code.className = 'panel-code';
    code.textContent = 'PREVIEW / 预览';
    const count = document.createElement('span');
    count.className = 'album-preview-count';
    count.textContent = `${pv.tracks.length} 首`;
    head.appendChild(code);
    head.appendChild(count);

    const listBox = document.createElement('div');
    listBox.className = 'album-preview-list';
    listBox.setAttribute('role', 'list');
    pv.tracks.forEach((track, i) => {
      const row = document.createElement('div');
      row.className = 'album-preview-item';
      row.setAttribute('role', 'listitem');
      const idx = document.createElement('span');
      idx.className = 'album-preview-idx';
      idx.textContent = String(i + 1).padStart(2, '0');
      const nm = document.createElement('span');
      nm.className = 'album-preview-name';
      nm.textContent = track.name;
      row.appendChild(idx);
      row.appendChild(nm);
      listBox.appendChild(row);
    });

    const foot = document.createElement('div');
    foot.className = 'album-preview-foot';
    const note = document.createElement('span');
    note.className = 'album-preview-note';
    note.textContent = '预览不会打断当前播放';
    const loadBtn = document.createElement('button');
    loadBtn.className = 'action action-primary album-preview-load';
    loadBtn.type = 'button';
    loadBtn.textContent = '载入并播放';
    loadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadAlbum(pv.path);
    });
    foot.appendChild(note);
    foot.appendChild(loadBtn);

    box.appendChild(head);
    box.appendChild(listBox);
    box.appendChild(foot);
    return box;
  }

  let albumCoverRunning = false;

  async function resolveAlbumCovers() {
    if (albumCoverRunning) return;
    albumCoverRunning = true;
    try {
      for (const album of state.albums) {
        if (album.coverUrl || album.coverResolved) continue;
        album.coverResolved = true;
        try {
          const found = await api.folderCover(album.path);
          if (found && found.url) {
            album.coverUrl = found.url;
            album.coverPath = found.path || '';
            saveAlbums();
            const card = el.albumList.querySelector(`.album-card[data-album="${CSS.escape(album.path)}"]`);
            if (card) {
              const cov = card.querySelector('.album-cover');
              if (cov) {
                cov.style.backgroundImage = `url("${album.coverUrl}")`;
                cov.textContent = '';
              }
            }
          }
        } catch (_e) {
          /* ignore */
        }
      }
    } finally {
      albumCoverRunning = false;
    }
  }

  function isInFolder(filePath, folderPath) {
    if (!filePath || !folderPath) return false;
    const f = String(filePath).replace(/\\/g, '/');
    const d = String(folderPath).replace(/\\/g, '/').replace(/\/+$/, '');
    return f === d || f.startsWith(d + '/');
  }

  // 预览专辑: 只读取内容, 绝不改变当前播放
  async function previewAlbum(album) {
    if (!album || !album.path) return;
    if (state.albumPreview && state.albumPreview.path === album.path) {
      state.albumPreview = null; // 再次点击收起
      renderAlbums();
      return;
    }
    setStatus('正在读取专辑…', 'ok');
    const lib = await api.scanFolder(album.path);
    if (!lib || !lib.tracks.length) {
      setStatus('无法读取该专辑', 'warn');
      return;
    }
    state.albumPreview = {
      path: album.path,
      name: lib.name,
      tracks: lib.tracks,
      coverUrl: lib.folderCoverUrl || album.coverUrl || '',
    };
    if (lib.folderCoverUrl) {
      album.coverUrl = lib.folderCoverUrl;
      album.coverPath = lib.folderCover || '';
    }
    album.trackCount = lib.tracks.length;
    saveAlbums();
    renderAlbums();
    setStatus(`预览 · ${lib.name}（${lib.tracks.length} 首）· 未打断播放`, 'ok');
  }

  // 显式载入专辑 (唯一会切换当前播放的专辑操作)
  async function loadAlbum(pathOrAlbum) {
    const albumPath =
      typeof pathOrAlbum === 'string' ? pathOrAlbum : pathOrAlbum && pathOrAlbum.path;
    if (!albumPath) return;
    state.albumPreview = null;
    const ok = await openFolderPath(albumPath, { autoplay: true });
    if (ok) {
      setView('list');
      setStatus('已载入专辑并开始播放', 'ok');
    }
  }

  // 添加专辑: 只登记到专辑库, 不打断当前播放
  async function addAlbum() {
    const folderPath = await api.openFolder();
    if (!folderPath) return;
    const lib = await api.scanFolder(folderPath);
    if (!lib || !lib.tracks.length) {
      setStatus('该文件夹没有可播放的音频', 'warn');
      return;
    }
    upsertAlbum({
      path: lib.folderPath,
      name: lib.name,
      coverPath: lib.folderCover || '',
      coverUrl: lib.folderCoverUrl || '',
      trackCount: lib.tracks.length,
      touch: true,
    });
    renderAlbums();
    setStatus(`已添加专辑 · ${lib.name}（未打断播放）`, 'ok');
  }

  async function chooseAlbumCover(album) {
    if (!album || !album.path) return;
    const res = await api.openCover();
    if (!res) return;
    await api.setFolderCover(album.path, res.path);
    album.coverPath = res.path;
    album.coverUrl = res.url;
    saveAlbums();
    renderAlbums();
    setStatus('已设置专辑封面', 'ok');
    // 正在播放该专辑且用的是专辑/自动封面时, 原地刷新 (不重新加载音频)
    if (
      isInFolder(state.audioPath, album.path) &&
      ['folder', 'auto', 'embedded', 'none'].includes(state.cover.kind)
    ) {
      state.cover = { url: res.url, path: res.path, kind: 'folder' };
      updateCoverUI();
    }
  }

  el.addAlbumBtn.addEventListener('click', addAlbum);
  renderAlbums();

  // ---------- audio loading ----------
  async function loadAudio(source, track, autoplay = false, resumeAt) {
    const { url, path, name } = source;
    const resumePlay = autoplay || !state.audio.paused;
    // 切歌前先记录上一首的播放位置
    if (state.audioPath && state.audioPath !== path) {
      savePosition(state.audioPath, state.audio.currentTime);
      persistPositions();
    }
    state.pendingResume = typeof resumeAt === 'number' ? resumeAt : getSavedPosition(path);
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
    setSubtitlePlaceholder('字幕将在此同步显示');
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
    setSubtitlePlaceholder('字幕已载入，播放时同步显示');
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
    savePosition(state.audioPath, state.audio.currentTime);
    persistPositions();
    saveSession();
  });
  state.audio.addEventListener('loadedmetadata', () => {
    updateTransport();
    if (state.pendingResume) {
      const t = state.pendingResume;
      const dur = state.audio.duration;
      if (!isFinite(dur) || t < dur - 2) {
        try {
          state.audio.currentTime = t;
          setStatus(`已回到上次位置 ${formatTime(t)}`, 'ok');
        } catch (_e) {
          /* ignore */
        }
      }
      state.pendingResume = 0;
    }
  });
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

  // 常驻字幕: 返回最后一条"已开始"的字幕。句间静音时保留上一句, 直到下一句出现;
  // 只有尚未到第一条时才返回 -1。
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
    return res;
  }

  function setSubtitlePlaceholder(text) {
    el.subLinePrev.innerHTML = '';
    el.subLineNext.innerHTML = '';
    el.subLinePrev.classList.add('is-empty');
    el.subLineNext.classList.add('is-empty');
    el.subtitleLine.classList.add('is-empty');
    el.subtitleLine.textContent = text || '';
    el.subProgressTrack.hidden = true;
    el.subProgress.style.width = '0%';
  }

  function updateSubtitle() {
    const cues = state.cues;
    const i = state.activeIndex;
    const cue = cues[i];
    if (!cue) {
      setSubtitlePlaceholder(cues.length ? '——' : '字幕将在此同步显示');
      return;
    }
    const prev = cues[i - 1];
    const next = cues[i + 1];
    el.subLinePrev.innerHTML = prev ? prev.html : '';
    el.subLineNext.innerHTML = next ? next.html : '';
    el.subLinePrev.classList.toggle('is-empty', !prev);
    el.subLineNext.classList.toggle('is-empty', !next);
    el.subtitleLine.classList.remove('is-empty');
    el.subtitleLine.innerHTML = cue.html;
    // 该句已结束(句间空隙)时保留文字, 但收起进度条
    el.subProgressTrack.hidden = state.audio.currentTime >= cue.end;
    updateSubtitleProgress(state.audio.currentTime);
    if (!reduceMotion) {
      el.subtitleRoll.classList.remove('is-rolling');
      void el.subtitleRoll.offsetWidth; // 重启动画
      el.subtitleRoll.classList.add('is-rolling');
    }
  }

  function updateSubtitleProgress(time) {
    const cue = state.cues[state.activeIndex];
    if (!cue) {
      el.subProgress.style.width = '0%';
      return;
    }
    const span = Math.max(0.001, cue.end - cue.start);
    const ratio = clamp((time - cue.start) / span, 0, 1);
    el.subProgress.style.width = (ratio * 100).toFixed(1) + '%';
  }

  let lastSubProgTick = 0;

  function maybeUpdateSubtitleProgress(time) {
    const now = performance.now();
    if (now - lastSubProgTick < 100) return;
    lastSubProgTick = now;
    const cue = state.cues[state.activeIndex];
    if (!cue) return;
    const ended = time >= cue.end;
    if (el.subProgressTrack.hidden !== ended) el.subProgressTrack.hidden = ended;
    if (!ended) updateSubtitleProgress(time);
  }

  // ---------- transcript auto scroll (方案 A) ----------
  const scrollState = { auto: true, user: false, timer: 0 };

  function scrollActiveCue(behavior) {
    if (!scrollState.auto || scrollState.user) return;
    const item = el.transcriptList.querySelector('.cue-item.is-active');
    if (!item) return;
    const container = el.transcriptList;
    const cRect = container.getBoundingClientRect();
    const iRect = item.getBoundingClientRect();
    const delta = iRect.top + iRect.height / 2 - (cRect.top + cRect.height / 2);
    const top = Math.max(0, container.scrollTop + delta);
    container.scrollTo({ top, behavior: behavior || (reduceMotion ? 'auto' : 'smooth') });
  }

  function markUserScroll() {
    if (!scrollState.auto) return;
    scrollState.user = true;
    el.scrollReturn.hidden = false;
    if (scrollState.timer) clearTimeout(scrollState.timer);
    scrollState.timer = setTimeout(() => {
      scrollState.user = false;
      el.scrollReturn.hidden = true;
      scrollActiveCue();
    }, 4500);
  }

  function returnToActiveCue() {
    if (scrollState.timer) clearTimeout(scrollState.timer);
    scrollState.user = false;
    el.scrollReturn.hidden = true;
    scrollActiveCue();
  }

  function setAutoScroll(on) {
    scrollState.auto = !!on;
    el.autoScrollBtn.classList.toggle('is-on', scrollState.auto);
    el.autoScrollBtn.setAttribute('aria-pressed', scrollState.auto ? 'true' : 'false');
    saveJSON(STORE.autoScroll, scrollState.auto);
    if (scrollState.auto) {
      scrollState.user = false;
      el.scrollReturn.hidden = true;
      scrollActiveCue();
    }
  }

  function updateTranscriptActive() {
    el.transcriptList.querySelectorAll('.cue-item').forEach((item, index) => {
      item.classList.toggle('is-active', index === state.activeIndex);
    });
    scrollActiveCue();
  }

  el.autoScrollBtn.addEventListener('click', () => setAutoScroll(!scrollState.auto));
  el.scrollReturn.addEventListener('click', returnToActiveCue);
  el.transcriptList.addEventListener('wheel', markUserScroll, { passive: true });
  el.transcriptList.addEventListener('touchmove', markUserScroll, { passive: true });
  el.transcriptList.addEventListener('pointerdown', (e) => {
    if (!e.target.closest || !e.target.closest('.cue-item')) markUserScroll();
  });

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
      if (state.activeIndex >= 0) maybeUpdateSubtitleProgress(t);
      if (state.ab.on && state.ab.b !== null && !audio.paused && t >= state.ab.b) {
        audio.currentTime = state.ab.a || 0;
      }
      if (state.isPlaying) {
        const now = performance.now();
        if (now - lastPosTick > 3000) {
          lastPosTick = now;
          savePosition(state.audioPath, t);
          persistPositions();
          saveSession();
        }
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
    saveJSON(STORE.transcribe, {
      modelSource: tstate().modelSource,
      modelDir: tstate().modelDir,
      device: tstate().device,
      compute: tstate().compute,
      scope: tstate().scope,
      format: tstate().format,
      vad: tstate().vad,
      skipExisting: tstate().skipExisting,
    });
  }

  function loadTranscribePrefs() {
    let p = loadJSON(STORE.transcribe, null);
    if (!p) p = loadJSON('resonance.transcribe', null); // 兼容改名前的键
    if (!p) return;
    if (p.modelSource) tstate().modelSource = p.modelSource;
    if (p.modelDir) tstate().modelDir = p.modelDir;
    if (p.device) tstate().device = p.device;
    if (p.compute) tstate().compute = p.compute;
    if (p.scope) tstate().scope = p.scope;
    if (p.format) tstate().format = p.format;
    if (typeof p.vad === 'boolean') tstate().vad = p.vad;
    if (typeof p.skipExisting === 'boolean') tstate().skipExisting = p.skipExisting;
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
    el.transcribeProgressWrap.hidden = pct <= 0;
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

  function outputExt() {
    return tstate().format === 'srt' ? '.zh.srt' : '.zh.vtt';
  }

  function audioPathFromOutput(output) {
    return String(output || '').replace(/\.zh\.(vtt|srt)$/i, '');
  }

  // 组装转写队列 (当前曲目 / 整个文件夹)
  function buildTranscribeQueue() {
    const t = tstate();
    if (t.scope === 'folder' && state.playlist.length) {
      return state.playlist.map((tr, i) => ({
        index: i,
        path: tr.path,
        name: tr.name,
        status: 'idle',
        percent: 0,
        output: '',
      }));
    }
    if (!state.audioPath) return [];
    const idx = state.currentIndex;
    const name =
      (idx >= 0 && state.playlist[idx] && state.playlist[idx].name) ||
      state.audioName ||
      basename(state.audioPath);
    return [{ index: 0, path: state.audioPath, name, status: 'idle', percent: 0, output: '' }];
  }

  const TQ_CLASS = { idle: '', run: 'is-run', done: 'is-done', skip: 'is-skip', fail: 'is-fail' };

  function tqStatusLabel(item) {
    if (item.status === 'run') return Math.round(item.percent || 0) + '%';
    if (item.status === 'done') return '完成';
    if (item.status === 'skip') return '跳过';
    if (item.status === 'fail') return '失败';
    return '等待';
  }

  function renderTranscribeQueue() {
    const q = tstate().queue;
    const show = q.length > 1;
    el.transcribeQueue.hidden = !show;
    el.transcribeQueueList.querySelectorAll('.tq-item').forEach((n) => n.remove());
    if (!show) return;
    updateQueueStat();
    q.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'tq-item ' + (TQ_CLASS[item.status] || '');
      row.setAttribute('role', 'listitem');
      row.setAttribute('data-index', String(item.index));
      const i = document.createElement('span');
      i.className = 'tq-idx';
      i.textContent = String(item.index + 1).padStart(2, '0');
      const n = document.createElement('span');
      n.className = 'tq-name';
      n.textContent = item.name;
      const s = document.createElement('span');
      s.className = 'tq-status';
      s.textContent = tqStatusLabel(item);
      row.appendChild(i);
      row.appendChild(n);
      row.appendChild(s);
      el.transcribeQueueList.appendChild(row);
    });
  }

  function updateQueueStat() {
    const q = tstate().queue;
    const done = q.filter((x) => x.status !== 'idle' && x.status !== 'run').length;
    el.transcribeQueueStat.textContent = `${done} / ${q.length}`;
  }

  function updateQueueItem(index, patch) {
    const q = tstate().queue;
    const item = q.find((x) => x.index === index);
    if (!item) return;
    Object.assign(item, patch);
    const row = el.transcribeQueueList.querySelector(`.tq-item[data-index="${index}"]`);
    if (!row) {
      renderTranscribeQueue();
      return;
    }
    row.className = 'tq-item ' + (TQ_CLASS[item.status] || '');
    const s = row.querySelector('.tq-status');
    if (s) s.textContent = tqStatusLabel(item);
    updateQueueStat();
    const active = row;
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function overallPercent() {
    const t = tstate();
    if (!t.filesTotal) return t.progress;
    const current = t.queue.find((x) => x.index === t.fileIndex);
    const cur = current ? (current.percent || 0) / 100 : 0;
    return clamp(((t.filesDone + cur) / t.filesTotal) * 100, 0, 100);
  }

  function updateScopeNote() {
    const t = tstate();
    const n = state.playlist.length;
    if (t.scope === 'folder') {
      el.transcribeScopeNote.textContent = n ? `将转写当前列表全部 ${n} 首（模型只加载一次）` : '当前没有列表';
    } else {
      el.transcribeScopeNote.textContent = state.audioPath ? '仅转写当前曲目' : '尚未加载音频';
    }
  }

  function setTranscribeScope(scope) {
    tstate().scope = scope;
    el.transcribeScope.querySelectorAll('.seg-btn').forEach((b) => {
      const on = b.dataset.scope === scope;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    el.transcribeStart.textContent = scope === 'folder' ? '批量转译' : '开始转译';
    updateScopeNote();
    persistTranscribe();
  }

  async function startTranscribe() {
    const t = tstate();
    if (t.running) return;
    if (t.modelSource === 'local' && !t.modelDir) {
      setStatus('请先选择本地模型目录', 'warn');
      setTranscribeStatus('请先选择本地模型目录', true);
      return;
    }
    const queue = buildTranscribeQueue();
    if (!queue.length) {
      setStatus('没有可转写的音频', 'warn');
      setTranscribeStatus('没有可转写的音频', true);
      return;
    }
    t.queue = queue;
    t.filesTotal = queue.length;
    t.filesDone = 0;
    t.fileIndex = -1;
    renderTranscribeQueue();

    const batch = queue.length > 1;
    const ext = outputExt();
    const config = {
      model_dir: t.modelSource === 'download' ? TRANSCRIBE_REPO : t.modelDir,
      allow_download: t.modelSource === 'download',
      format: t.format,
      device: t.device,
      compute_type: t.compute,
      language: 'ja',
      task: 'translate',
      beam_size: 5,
      vad_filter: t.vad,
      skip_existing: t.skipExisting,
    };
    if (batch) {
      config.audios = queue.map((x) => ({ audio: x.path, output: x.path + ext }));
    } else {
      config.audio = queue[0].path;
      config.output = queue[0].path + ext;
    }

    setTranscribeProgress(0);
    setTranscribeStatus(batch ? `准备批量转写 ${queue.length} 个文件…` : '正在启动转写…');
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

  // 生成字幕后登记并 (若为当前曲目) 立即载入
  async function registerSubtitle(output) {
    if (!output) return null;
    const url = await api.registerPath(output);
    const audio = audioPathFromOutput(output);
    const idx = state.playlist.findIndex((x) => x.path === audio);
    if (idx >= 0) {
      state.playlist[idx].subPath = output;
      state.playlist[idx].subUrl = url;
      state.playlist[idx].subName = basename(output);
      updatePlaylistSub(idx);
    }
    if (audio === state.audioPath) {
      await loadSubtitle({ url, path: output, name: basename(output) });
    }
    return url;
  }

  function updatePlaylistSub(index) {
    const row = el.playlistList.querySelector(`.pl-item[data-index="${index}"]`);
    const track = state.playlist[index];
    if (!row || !track || !track.subUrl) return;
    const badges = row.querySelector('.pl-badges');
    if (badges && !badges.querySelector('.pl-badge:not(.is-cover)')) {
      const b = document.createElement('span');
      b.className = 'pl-badge';
      b.textContent = '字幕';
      badges.insertBefore(b, badges.firstChild);
    }
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
    if (Array.isArray(evt.outputs)) {
      setTranscribeProgress(100);
      const parts = [`成功 ${evt.ok || 0}`];
      if (evt.skipped) parts.push(`跳过 ${evt.skipped}`);
      if (evt.failed) parts.push(`失败 ${evt.failed}`);
      setTranscribeStatus(`批量完成 · ${parts.join(' · ')} · ${evt.elapsed || 0}s`);
      setStatus(`批量转译完成 · ${evt.ok || 0} 个文件`, evt.failed ? 'warn' : 'ok');
      endTranscribeUi();
      saveSession();
      return;
    }
    const output = evt.output;
    setTranscribeProgress(100);
    setTranscribeStatus('完成 · ' + (evt.count || 0) + ' 条字幕 · ' + (evt.elapsed || 0) + 's');
    setStatus('转写完成 · ' + (evt.count || 0) + ' 条字幕', 'ok');
    endTranscribeUi();
    if (output) {
      try {
        await registerSubtitle(output);
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
      case 'batch':
        tstate().filesTotal = evt.total || 0;
        renderTranscribeQueue();
        break;
      case 'file':
        tstate().fileIndex = evt.index;
        updateQueueItem(evt.index, { status: evt.skipped ? 'skip' : 'run', percent: 0 });
        if (!evt.skipped) setStatus(`转写中 · ${evt.index + 1}/${evt.total}`, 'ok');
        setTranscribeStatus(`${evt.skipped ? '跳过已有' : '转写'} ${evt.index + 1}/${evt.total} · ${evt.name || ''}`);
        break;
      case 'progress': {
        let pct = removeNaN(evt.percent, 0);
        if (!pct && evt.total) pct = (evt.completed / evt.total) * 100;
        pct = clamp(pct, 0, 100);
        if (evt.what === 'download') {
          setTranscribeStatus('正在下载模型' + (evt.file ? ' · ' + evt.file : ''));
          setTranscribeProgress(pct);
        } else if (evt.index != null && tstate().filesTotal) {
          updateQueueItem(evt.index, { status: 'run', percent: pct });
          setTranscribeProgress(overallPercent());
        } else if (evt.completed != null && evt.total) {
          setTranscribeStatus('转写进行中 · ' + Math.round(pct) + '%');
          setTranscribeProgress(pct);
        } else {
          setTranscribeProgress(pct);
        }
        break;
      }
      case 'segment':
        el.transcribeSegment.hidden = false;
        el.transcribeSegment.textContent = evt.text || '';
        break;
      case 'file_done':
        tstate().filesDone += 1;
        updateQueueItem(evt.index, { status: evt.skipped ? 'skip' : 'done', output: evt.output || '' });
        setTranscribeProgress(overallPercent());
        if (evt.output && !evt.skipped) registerSubtitle(evt.output).catch(() => {});
        break;
      case 'file_error':
        tstate().filesDone += 1;
        updateQueueItem(evt.index, { status: 'fail' });
        setTranscribeProgress(overallPercent());
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
        setTranscribeStatus('已取消', true);
        endTranscribeUi();
        break;
      default:
        break;
    }
  }

  function openTranscribe() {
    if (!state.audioPath && !state.playlist.length) {
      setStatus('请先加载音频或文件夹', 'warn');
      return;
    }
    const t = tstate();
    el.transcribeModal.hidden = false;
    el.transcribeModel.value = t.modelSource;
    el.transcribeDevice.value = t.device;
    el.transcribeCompute.value = t.compute;
    el.transcribeFormat.value = t.format;
    el.transcribeVad.checked = !!t.vad;
    el.transcribeSkip.checked = !!t.skipExisting;
    setTranscribeScope(t.scope);
    updateTranscribeModelHint();
    setTranscribeProgress(t.progress);
    setTranscribeStatus(t.running ? '转写进行中…' : '');
    el.transcribeSegment.hidden = true;
    if (!t.running) {
      t.queue = [];
    }
    renderTranscribeQueue();
    if (!t.running) detectEnvAndShow();
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
  el.transcribeFormat.addEventListener('change', () => {
    tstate().format = el.transcribeFormat.value;
    persistTranscribe();
  });
  el.transcribeVad.addEventListener('change', () => {
    tstate().vad = el.transcribeVad.checked;
    persistTranscribe();
  });
  el.transcribeSkip.addEventListener('change', () => {
    tstate().skipExisting = el.transcribeSkip.checked;
    persistTranscribe();
  });
  el.transcribeScope.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTranscribeScope(btn.dataset.scope));
  });
  api.onTranscribeEvent(onTranscribeEvent);
  api.onMenuTranscribe(openTranscribe);
  loadTranscribePrefs();
  setTranscribeScope(tstate().scope);
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
  const ARCHIVE_W_KEY = STORE.archiveW;
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

  const savedW = Number.parseFloat(
    localStorage.getItem(ARCHIVE_W_KEY) || localStorage.getItem('resonance.archiveWidth')
  );
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

  // ---------- session restore ----------
  async function restoreSession() {
    const s = loadJSON(STORE.session, null);
    if (!s || !s.folderPath) return false;
    let lib = null;
    try {
      lib = await api.scanFolder(s.folderPath);
    } catch (_e) {
      lib = null;
    }
    if (!lib || !lib.tracks || !lib.tracks.length) {
      clearSession();
      return false;
    }
    applyLibrary(lib, { noLoad: true });
    setView('list');
    const index = clamp(s.currentIndex | 0, 0, lib.tracks.length - 1);
    const track = lib.tracks[index];
    const resumeAt = typeof s.currentTime === 'number' && s.currentTime > 3 ? s.currentTime : undefined;
    state.currentIndex = index;
    renderPlaylist();
    await loadAudio({ url: track.url, path: track.path, name: track.name }, track, false, resumeAt);
    setStatus(`已恢复上次播放 · ${lib.name}`, 'ok');
    return true;
  }

  window.addEventListener('beforeunload', () => {
    savePosition(state.audioPath, state.audio.currentTime);
    persistPositions();
    saveSession();
  });

  // ---------- init ----------
  updateVolIcon();
  updateAbUI();
  setView('list');
  renderAlbums();
  setAutoScroll(loadJSON(STORE.autoScroll, true));
  requestAnimationFrame(frame);
  restoreSession();

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
          applyLibrary(lib, { noLoad: true });
          setView('list');
          loadTrack(0, false);
          return lib.tracks.length;
        }),
      playTrack: (index) => loadTrack(index),
      albums: {
        render: renderAlbums,
        list: () => state.albums,
        openPath: (p) => openFolderPath(p, { autoplay: false }),
        preview: (album) => previewAlbum(album),
        previewByPath: (p) => previewAlbum({ path: p }),
        previewState: () => state.albumPreview,
        load: loadAlbum,
        setCover: async (folderPath, coverPath) => {
          await api.setFolderCover(folderPath, coverPath);
          const a = state.albums.find((x) => x.path === folderPath);
          if (a) a.coverPath = coverPath;
          saveAlbums();
          renderAlbums();
          return true;
        },
        remove: removeAlbum,
      },
      session: {
        save: () => {
          savePosition(state.audioPath, state.audio.currentTime);
          persistPositions();
          saveSession();
          return loadJSON(STORE.session, null);
        },
        restore: restoreSession,
        positions: () => positions,
      },
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
        setScope: setTranscribeScope,
        buildQueue: () => buildTranscribeQueue(),
        queue: () => tstate().queue,
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
