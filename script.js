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

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
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

const renderTracks = () => {
  const query = searchInput.value.trim().toLowerCase();
  const visibleTracks = tracks.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(query));
  document.querySelector('#library-count').textContent = `${tracks.length} 首`;
  document.querySelector('#nav-count').textContent = tracks.length;
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

const loadTrack = (index, autoplay = false) => {
  if (!tracks[index]) return;
  currentIndex = index;
  audio.src = tracks[index].url;
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
  const newTracks = files.map((file) => ({ title: trackLabel(file.name), artist: '本地文件', album: '本地音乐', duration: 0, url: URL.createObjectURL(file), file }));
  tracks.push(...newTracks);
  newTracks.forEach((track) => {
    const probe = new Audio(); probe.src = track.url; probe.addEventListener('loadedmetadata', () => { track.duration = probe.duration; renderTracks(); });
  });
  renderTracks();
  if (currentIndex < 0) loadTrack(0);
  showToast(`已导入 ${files.length} 首歌曲`);
};

const removeTrack = (index) => {
  const removed = tracks[index];
  if (!removed) return;
  URL.revokeObjectURL(removed.url);
  tracks.splice(index, 1);
  if (index === currentIndex) { audio.pause(); audio.removeAttribute('src'); currentIndex = -1; updateCurrent(); }
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
progressRange.addEventListener('input', () => { if (audio.duration) audio.currentTime = (progressRange.value / 100) * audio.duration; updateRange(progressRange, progressRange.value); });
searchInput.addEventListener('input', renderTracks);
document.querySelectorAll('[data-scroll]').forEach((item) => item.addEventListener('click', () => document.getElementById(item.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' })));
document.querySelectorAll('#like-button, #bar-like').forEach((button) => button.addEventListener('click', () => { if (currentIndex < 0) return showToast('选择一首歌曲后再收藏'); document.querySelectorAll('#like-button, #bar-like').forEach((item) => item.classList.toggle('liked')); }));
document.querySelector('#theme-button').addEventListener('click', () => showToast('Luma 保持夜间模式，适合专注聆听'));
document.addEventListener('keydown', (event) => { if (event.code === 'Space' && event.target.tagName !== 'INPUT') { event.preventDefault(); playPause(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); } });
audio.addEventListener('play', updatePlayButton);
audio.addEventListener('pause', updatePlayButton);
audio.addEventListener('timeupdate', () => { currentTime.textContent = formatTime(audio.currentTime); totalTime.textContent = formatTime(audio.duration); const value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0; progressRange.value = value; updateRange(progressRange, value); });
audio.addEventListener('ended', () => { if (isRepeat) loadTrack(currentIndex, true); else nextTrack(); });
audio.volume = 0.8; updateRange(volumeRange, .8, 1); updateRange(progressRange, 0); renderTracks();
