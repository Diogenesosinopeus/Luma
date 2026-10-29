const audio = document.querySelector('#audio');
const audioInput = document.querySelector('#audio-input');
const dropZone = document.querySelector('#drop-zone');
const trackList = document.querySelector('#track-list');
const emptyState = document.querySelector('#empty-state');
const searchInput = document.querySelector('#search-input');
const progressRange = document.querySelector('#progress-range');
const volumeRange = document.querySelector('#volume-range');
const playButton = document.querySelector('#play-button');
const nowTitle = document.querySelector('#now-title');
const nowArtist = document.querySelector('#now-artist');
const barTitle = document.querySelector('#bar-title');
const barArtist = document.querySelector('#bar-artist');
const currentTime = document.querySelector('#current-time');
const totalTime = document.querySelector('#total-time');
const toast = document.querySelector('#toast');

let tracks = [];
let currentIndex = -1;
let isShuffle = false;
let isRepeat = false;
let toastTimer;
let database = null;
let databaseReady = Promise.resolve();
let sortMode = 'recent';
let statsView = 'weekly';
const listeningStorage = {
  get: () => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('luma-listening-stats-v1') || 'null');
      return saved && saved.days ? { days: saved.days, total: Number(saved.total) || 0 } : { days: {}, total: 0 };
    } catch { return { days: {}, total: 0 }; }
  },
  set: (value) => { try { window.localStorage.setItem('luma-listening-stats-v1', JSON.stringify(value)); } catch {} },
};
const playbackStorage = {
  get: () => { try { return JSON.parse(window.localStorage.getItem('luma-playback-state') || 'null'); } catch { return null; } },
  set: (value) => { try { window.localStorage.setItem('luma-playback-state', JSON.stringify(value)); } catch {} },
  clear: () => { try { window.localStorage.removeItem('luma-playback-state'); } catch {} },
};
let listeningStats = listeningStorage.get();
let listeningClock = null;
let pendingResumeTime = null;
let lastSavedPosition = -1;

const DB_NAME = 'luma-local-player';
const DB_VERSION = 1;
const TRACK_STORE = 'tracks';

const openDatabase = () => new Promise((resolve, reject) => {
  if (!('indexedDB' in window)) {
    reject(new Error('当前浏览器不支持本地保存'));
    return;
  }
  const request = window.indexedDB.open(DB_NAME, DB_VERSION);
  request.addEventListener('upgradeneeded', () => {
    if (!request.result.objectStoreNames.contains(TRACK_STORE)) request.result.createObjectStore(TRACK_STORE, { keyPath: 'id' });
  });
  request.addEventListener('success', () => resolve(request.result));
  request.addEventListener('error', () => reject(request.error));
});

const readStoredTracks = () => new Promise((resolve, reject) => {
  const request = database.transaction(TRACK_STORE, 'readonly').objectStore(TRACK_STORE).getAll();
  request.addEventListener('success', () => resolve(request.result || []));
  request.addEventListener('error', () => reject(request.error));
});

const saveStoredTrack = (track) => new Promise((resolve, reject) => {
  const { url, file, ...storedTrack } = track;
  const request = database.transaction(TRACK_STORE, 'readwrite').objectStore(TRACK_STORE).put(storedTrack);
  request.addEventListener('success', resolve);
  request.addEventListener('error', () => reject(request.error));
});

const deleteStoredTrack = (id) => new Promise((resolve, reject) => {
  if (!database) { resolve(); return; }
  const request = database.transaction(TRACK_STORE, 'readwrite').objectStore(TRACK_STORE).delete(id);
  request.addEventListener('success', resolve);
  request.addEventListener('error', () => reject(request.error));
});

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

const formatUsage = (seconds) => {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  if (seconds === 0) return '0 分钟';
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 1) return `${seconds} 秒`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} 小时${minutes ? ` ${minutes} 分钟` : ''}` : `${minutes} 分钟`;
};

const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getSunday = (date) => {
  const sunday = new Date(date);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  return sunday;
};

const shortDuration = (seconds) => {
  const totalMinutes = Math.floor(Number(seconds) / 60);
  if (totalMinutes < 1) return `${Math.floor(Number(seconds) || 0)}秒`;
  if (totalMinutes < 60) return `${totalMinutes}分`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}小时${minutes ? `${minutes}分` : ''}`;
};

const statLevel = (seconds) => {
  if (!seconds) return 0;
  if (seconds < 300) return 1;
  if (seconds < 1200) return 2;
  if (seconds < 3600) return 3;
  return 4;
};

const renderWeeklyStats = () => {
  const weeklyPanel = document.querySelector('#stats-weekly');
  const weeks = 26;
  const currentSunday = getSunday(new Date());
  const firstSunday = new Date(currentSunday);
  firstSunday.setDate(firstSunday.getDate() - (weeks - 1) * 7);
  const monthLabels = [];
  const cells = [];
  const weekdayLabels = ['日', '', '二', '', '四', '', '六'];
  let previousMonth = -1;

  for (let week = 0; week < weeks; week += 1) {
    const weekStart = new Date(firstSunday);
    weekStart.setDate(firstSunday.getDate() + week * 7);
    const month = weekStart.getMonth();
    monthLabels.push(`<span>${month !== previousMonth ? `${month + 1}月` : ''}</span>`);
    previousMonth = month;
    for (let day = 0; day < 7; day += 1) {
      const cellDate = new Date(weekStart);
      cellDate.setDate(weekStart.getDate() + day);
      const seconds = listeningStats.days[dateKey(cellDate)] || 0;
      const future = cellDate > new Date();
      const label = `${cellDate.getMonth() + 1}月${cellDate.getDate()}日 · ${shortDuration(seconds)}`;
      cells.push(`<span class="activity-cell" data-level="${statLevel(seconds)}"${future ? ' data-empty="true"' : ''} title="${label}"></span>`);
    }
  }

  weeklyPanel.innerHTML = `<div class="activity-months">${monthLabels.join('')}</div><div class="activity-layout"><div class="activity-days">${weekdayLabels.map((label) => `<span>${label}</span>`).join('')}</div><div class="activity-grid">${cells.join('')}</div></div><div class="stats-legend"><span>少</span><i class="legend-cell"></i><i class="legend-cell" data-level="1"></i><i class="legend-cell" data-level="2"></i><i class="legend-cell" data-level="3"></i><i class="legend-cell" data-level="4"></i><span>多</span></div>`;
};

const renderDailyStats = () => {
  const dailyPanel = document.querySelector('#stats-daily');
  const sunday = getSunday(new Date());
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const values = names.map((_, index) => {
    const day = new Date(sunday);
    day.setDate(sunday.getDate() + index);
    return listeningStats.days[dateKey(day)] || 0;
  });
  const max = Math.max(...values, 1);
  dailyPanel.innerHTML = `<div class="daily-list">${values.map((seconds, index) => `<div class="daily-row"><span class="daily-day">${names[index]}</span><span class="daily-bar"><i style="width:${Math.round((seconds / max) * 100)}%"></i></span><span class="daily-value">${shortDuration(seconds)}</span></div>`).join('')}</div>`;
};

const renderTotalStats = () => {
  const totalPanel = document.querySelector('#stats-total-panel');
  const entries = Object.entries(listeningStats.days).filter(([, seconds]) => seconds > 0);
  const longestDay = entries.reduce((best, entry) => (!best || entry[1] > best[1] ? entry : best), null);
  totalPanel.innerHTML = `<div class="total-panel"><div class="total-metric"><span>累计听歌</span><strong>${formatUsage(listeningStats.total)}</strong></div><div class="total-metric"><span>活跃天数</span><strong>${entries.length} 天</strong></div><div class="total-metric"><span>最常听的一天</span><strong>${longestDay ? shortDuration(longestDay[1]) : '—'}</strong></div></div>`;
};

const renderStats = () => {
  renderWeeklyStats();
  renderDailyStats();
  renderTotalStats();
  document.querySelector('#stats-total').textContent = `累计 ${formatUsage(listeningStats.total)}`;
  document.querySelector('#stats-caption').textContent = statsView === 'daily' ? '本周 · 周日开始' : statsView === 'total' ? '所有已保存记录' : '最近 26 周 · 周日开始';
};

const recordListeningInterval = (startTime, endTime) => {
  let cursor = startTime;
  while (cursor < endTime) {
    const currentDate = new Date(cursor);
    const nextDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1).getTime();
    const segmentEnd = Math.min(endTime, nextDay);
    const seconds = (segmentEnd - cursor) / 1000;
    const key = dateKey(currentDate);
    listeningStats.days[key] = (listeningStats.days[key] || 0) + seconds;
    listeningStats.total += seconds;
    cursor = segmentEnd;
  }
  listeningStorage.set(listeningStats);
  updateUsage();
  renderStats();
};

const flushListeningTime = () => {
  const now = Date.now();
  if (listeningClock && currentIndex >= 0 && !audio.paused && !audio.ended) recordListeningInterval(listeningClock, now);
  listeningClock = now;
};

const updateUsage = () => {
  document.querySelector('#usage-time').textContent = formatUsage(listeningStats.total);
  document.querySelector('#usage-tracks').textContent = `${tracks.length} 首`;
};

const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
};

const updateRange = (range, value, max = 100) => {
  const percent = max ? (Number(value) / Number(max)) * 100 : 0;
  range.style.background = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${percent}%, #39423d ${percent}%, #39423d 100%)`;
};

const trackLabel = (fileName) => fileName.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || '未命名歌曲';

const probeTrack = (track) => {
  const probe = new Audio();
  probe.src = track.url;
  probe.addEventListener('loadedmetadata', () => {
    track.duration = probe.duration;
    renderTracks();
    if (database) saveStoredTrack(track).catch(() => {});
  });
};

const renderTracks = () => {
  const query = searchInput.value.trim().toLowerCase();
  const visibleTracks = tracks.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(query));
  visibleTracks.sort((a, b) => sortMode === 'name' ? a.title.localeCompare(b.title, 'zh-CN') : (b.addedAt || 0) - (a.addedAt || 0));
  document.querySelector('#library-count').textContent = `${tracks.length} 首`;
  document.querySelector('#nav-count').textContent = tracks.length;
  updateUsage();
  emptyState.style.display = visibleTracks.length ? 'none' : 'flex';
  if (!visibleTracks.length) {
    emptyState.querySelector('strong').textContent = tracks.length ? '没有找到匹配歌曲' : '播放列表还是空的';
    emptyState.querySelector('p').textContent = tracks.length ? '换个关键词试试。' : '点击上方按钮导入本地音乐，马上开始。';
  }
  trackList.querySelectorAll('.track-row').forEach((row) => row.remove());
  visibleTracks.forEach((track, visibleIndex) => {
    const realIndex = tracks.indexOf(track);
    const row = document.createElement('div');
    row.className = `track-row${realIndex === currentIndex ? ' current' : ''}`;
    row.dataset.index = realIndex;
    row.innerHTML = `
      <span class="track-index">${String(visibleIndex + 1).padStart(2, '0')}</span>
      <div class="track-main"><div class="track-thumb">${realIndex === currentIndex ? '♫' : '◌'}</div><div class="track-meta"><div class="track-name" title="${track.title}">${track.title}</div><div class="track-artist">${track.artist}</div></div></div>
      <span class="track-album">本地音乐</span><span class="track-duration">${formatTime(track.duration)}</span><button class="track-menu" type="button" aria-label="移除 ${track.title}" data-remove="${realIndex}">···</button>`;
    row.addEventListener('click', (event) => {
      if (event.target.closest('[data-remove]')) return;
      loadTrack(realIndex, true);
    });
    row.querySelector('[data-remove]').addEventListener('click', (event) => {
      event.stopPropagation();
      removeTrack(realIndex);
    });
    trackList.appendChild(row);
  });
};

const updateCurrent = () => {
  const track = tracks[currentIndex];
  if (!track) {
    nowTitle.textContent = '还没有歌曲'; nowArtist.textContent = '导入音乐后开始播放'; barTitle.textContent = '未选择歌曲'; barArtist.textContent = 'Luma 本地音乐';
    return;
  }
  nowTitle.textContent = track.title; nowArtist.textContent = track.artist; barTitle.textContent = track.title; barArtist.textContent = track.artist;
  document.body.classList.toggle('is-playing', !audio.paused);
  renderTracks();
};

const savePlaybackState = () => {
  const track = tracks[currentIndex];
  if (!track) return;
  const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  playbackStorage.set({ trackId: track.id, position });
  lastSavedPosition = position;
};

const loadTrack = (index, autoplay = false, resumeAt = null) => {
  if (!tracks[index]) return;
  savePlaybackState();
  currentIndex = index;
  pendingResumeTime = Number.isFinite(resumeAt) ? Math.max(0, resumeAt) : null;
  lastSavedPosition = -1;
  audio.src = tracks[index].url;
  playbackStorage.set({ trackId: tracks[index].id, position: pendingResumeTime || 0 });
  updateCurrent();
  progressRange.value = 0; updateRange(progressRange, 0);
  if (autoplay) audio.play().catch(() => showToast('点击播放按钮开始播放'));
};

const playPause = () => {
  if (!tracks.length) { showToast('先导入一些本地音乐吧'); return; }
  if (currentIndex < 0) loadTrack(0);
  if (audio.paused) audio.play().catch(() => showToast('浏览器阻止了自动播放，请再次点击播放')); else audio.pause();
};

const updatePlayButton = () => {
  const playing = !audio.paused && currentIndex >= 0;
  playButton.textContent = playing ? 'Ⅱ' : '▶';
  playButton.setAttribute('aria-label', playing ? '暂停' : '播放');
  document.body.classList.toggle('is-playing', playing);
};

const nextTrack = () => {
  if (!tracks.length) return showToast('播放列表还是空的');
  let index;
  if (isShuffle && tracks.length > 1) { do { index = Math.floor(Math.random() * tracks.length); } while (index === currentIndex); } else index = (currentIndex + 1) % tracks.length;
  loadTrack(index, true);
};

const previousTrack = () => {
  if (!tracks.length) return showToast('播放列表还是空的');
  if (audio.currentTime > 4) { audio.currentTime = 0; return; }
  loadTrack((currentIndex - 1 + tracks.length) % tracks.length, true);
};

const addFiles = (fileList) => {
  const files = [...fileList].filter((file) => file.type.startsWith('audio/') || /\.(mp3|wav|m4a|flac|aac|ogg|opus)$/i.test(file.name));
  if (!files.length) { showToast('请选择音频文件'); return; }
  const newTracks = files.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID?.() || Date.now()}`, title: trackLabel(file.name), artist: '本地文件', album: '本地音乐', duration: 0, addedAt: Date.now(), url: URL.createObjectURL(file), blob: file }));
  tracks.push(...newTracks);
  newTracks.forEach(probeTrack);
  renderTracks();
  if (currentIndex < 0) loadTrack(0);
  databaseReady.then(() => {
    if (!database) throw new Error('本机保存不可用');
    return Promise.all(newTracks.map((track) => saveStoredTrack(track)));
  }).then(() => showToast(`已导入 ${files.length} 首歌曲，并保存到本机`)).catch(() => showToast('歌曲已导入，但本机保存失败'));
};

const removeTrack = (index) => {
  const removed = tracks[index];
  if (!removed) return;
  URL.revokeObjectURL(removed.url);
  deleteStoredTrack(removed.id).catch(() => showToast('歌曲已移除，但本机记录清理失败'));
  tracks.splice(index, 1);
  if (index === currentIndex) { audio.pause(); audio.removeAttribute('src'); currentIndex = -1; pendingResumeTime = null; playbackStorage.clear(); updateCurrent(); }
  else if (index < currentIndex) currentIndex -= 1;
  renderTracks(); updatePlayButton(); showToast(`已移除「${removed.title}」`);
};

audioInput.addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (event) => { event.preventDefault(); dropZone.classList.remove('dragover'); addFiles(event.dataTransfer.files); });
playButton.addEventListener('click', playPause);
document.querySelector('#next-button').addEventListener('click', nextTrack);
document.querySelector('#previous-button').addEventListener('click', previousTrack);
document.querySelector('#shuffle-button').addEventListener('click', () => { isShuffle = !isShuffle; document.querySelector('#shuffle-button').classList.toggle('active', isShuffle); showToast(isShuffle ? '已开启随机播放' : '已关闭随机播放'); });
document.querySelector('#repeat-button').addEventListener('click', () => { isRepeat = !isRepeat; document.querySelector('#repeat-button').classList.toggle('active', isRepeat); showToast(isRepeat ? '已开启单曲循环' : '已关闭单曲循环'); });
document.querySelector('#mute-button').addEventListener('click', (event) => { audio.muted = !audio.muted; event.currentTarget.textContent = audio.muted ? '◕' : '◖'; });
volumeRange.addEventListener('input', () => { audio.volume = volumeRange.value; updateRange(volumeRange, volumeRange.value, 1); });
progressRange.addEventListener('input', () => { if (audio.duration) audio.currentTime = (progressRange.value / 100) * audio.duration; updateRange(progressRange, progressRange.value); savePlaybackState(); });
searchInput.addEventListener('input', renderTracks);
document.querySelector('#sort-button').addEventListener('click', (event) => {
  sortMode = sortMode === 'recent' ? 'name' : 'recent';
  event.currentTarget.innerHTML = sortMode === 'recent' ? '最近添加 <span>↕</span>' : '按名称 <span>↕</span>';
  renderTracks();
  showToast(sortMode === 'recent' ? '已按最近添加排序' : '已按名称排序');
});
document.querySelectorAll('[data-stats-view]').forEach((tab) => tab.addEventListener('click', (event) => {
  statsView = event.currentTarget.dataset.statsView;
  document.querySelectorAll('[data-stats-view]').forEach((item) => {
    const active = item === event.currentTarget;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  document.querySelector('#stats-weekly').hidden = statsView !== 'weekly';
  document.querySelector('#stats-daily').hidden = statsView !== 'daily';
  document.querySelector('#stats-total-panel').hidden = statsView !== 'total';
  renderStats();
}));
document.querySelectorAll('[data-scroll]').forEach((item) => item.addEventListener('click', () => document.getElementById(item.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' })));
document.querySelectorAll('#like-button, #bar-like').forEach((button) => button.addEventListener('click', () => { if (currentIndex < 0) return showToast('选择一首歌曲后再收藏'); document.querySelectorAll('#like-button, #bar-like').forEach((item) => item.classList.toggle('liked')); }));
document.querySelector('#theme-button').addEventListener('click', () => showToast('Luma 保持夜间模式，适合专注聆听'));
document.addEventListener('keydown', (event) => { if (event.code === 'Space' && event.target.tagName !== 'INPUT') { event.preventDefault(); playPause(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); } });
audio.addEventListener('play', () => { listeningClock = Date.now(); updatePlayButton(); });
audio.addEventListener('pause', () => { flushListeningTime(); updatePlayButton(); savePlaybackState(); });
audio.addEventListener('loadedmetadata', () => {
  if (pendingResumeTime !== null) {
    audio.currentTime = Math.min(pendingResumeTime, Math.max((audio.duration || pendingResumeTime) - 0.25, 0));
    pendingResumeTime = null;
  }
  currentTime.textContent = formatTime(audio.currentTime);
  totalTime.textContent = formatTime(audio.duration);
  savePlaybackState();
});
audio.addEventListener('timeupdate', () => { currentTime.textContent = formatTime(audio.currentTime); totalTime.textContent = formatTime(audio.duration); const value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0; progressRange.value = value; updateRange(progressRange, value); if (Math.abs(audio.currentTime - lastSavedPosition) >= 1) savePlaybackState(); });
audio.addEventListener('ended', () => { if (isRepeat) loadTrack(currentIndex, true); else nextTrack(); });
audio.volume = 0.8; updateRange(volumeRange, .8, 1); updateRange(progressRange, 0); renderTracks(); renderStats();
setInterval(flushListeningTime, 1000);
document.addEventListener('visibilitychange', () => { flushListeningTime(); savePlaybackState(); });
window.addEventListener('beforeunload', () => { flushListeningTime(); savePlaybackState(); });

const restoreLocalLibrary = async () => {
  try {
    database = await openDatabase();
    const storedTracks = await readStoredTracks();
    const existingIds = new Set(tracks.map((track) => track.id));
    const restoredTracks = storedTracks.filter((track) => !existingIds.has(track.id)).map((track) => ({ ...track, url: URL.createObjectURL(track.blob) }));
    tracks = [...tracks, ...restoredTracks];
    restoredTracks.forEach(probeTrack);
    renderTracks();
    if (tracks.length) {
      const savedPlayback = playbackStorage.get();
      const savedIndex = savedPlayback?.trackId ? tracks.findIndex((track) => track.id === savedPlayback.trackId) : -1;
      loadTrack(savedIndex >= 0 ? savedIndex : 0, false, savedIndex >= 0 ? Number(savedPlayback.position) || 0 : null);
    }
  } catch (error) {
    showToast(error.message || '本机保存不可用');
  }
};

databaseReady = restoreLocalLibrary();
