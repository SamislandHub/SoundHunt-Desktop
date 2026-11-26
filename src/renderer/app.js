/** 小点声桌面版 —— 渲染进程总控 */
import { Player, fmtTime } from './Player.js';
import { VinylView, WaveView } from './visual.js';
import { isCollection } from '../core/Track.js';

const $ = (id) => document.getElementById(id);
const api = window.api;
const Q = { QUALITY_64K: 30216, QUALITY_132K: 30232, QUALITY_FLAC: 30280 };

const state = {
  feedTracks: [], searchTracks: [], favTracks: [],
  currentView: 'home', loadingFeed: false, proxyPort: 0,
  quality: Q.QUALITY_132K, playMode: 'random',
};

let player, vinyl, wave;
let toastTimer = null;

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function proxyImg(url) {
  if (!url) return '';
  if (!state.proxyPort) return url;
  return `http://127.0.0.1:${state.proxyPort}/img?u=` + encodeURIComponent(url);
}

function trackItemHTML(t, idx, playingId) {
  const fav = state.favTracks.some((f) => f.source === t.source && f.id === t.id);
  const coll = isCollection(t) ? '<span class="ti-collection">合集</span>' : '';
  const dur = fmtTime(t.durationMs);
  return `<div class="track-item${t.stableIdKey === playingId ? ' playing' : ''}" data-idx="${idx}">
    <div class="ti-thumb${t.stableIdKey === playingId && player.playing ? ' spin' : ''}">
      <img src="${proxyImg(t.cover)}" onerror="this.style.display='none'"><div class="ring"></div>
    </div>
    <div class="ti-meta">
      <div class="ti-title">${esc(t.title)}</div>
      <div class="ti-sub"><span>${esc(t.artist || '未知歌手')}</span><span>${dur}</span><span class="ti-tag">${t.source === 'bilibili' ? 'B站' : ''}</span>${coll}</div>
    </div>
    <button class="ti-fav${fav ? ' on' : ''}" data-fav="${idx}">${fav ? '♥' : '♡'}</button>
  </div>`;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderList(containerId, tracks, playingId) {
  const el = $(containerId);
  el.innerHTML = tracks.map((t, i) => {
    t.stableIdKey = t.source + ':' + t.id;
    return trackItemHTML(t, i, playingId);
  }).join('');
}

// ---------------- 播放状态同步 ----------------
function onPlayerState(kind) {
  const t = player.current();
  if (kind === 'progress') {
    updateProgress();
    return;
  }
  updateMiniBar();
  updatePlayerPage();
  // 高亮当前曲目
  document.querySelectorAll('.track-item').forEach((el) => {
    el.classList.remove('playing');
    const item = el.closest('.track-list');
    let arr = null;
    if (item?.id === 'feed-list') arr = state.feedTracks;
    else if (item?.id === 'search-list') arr = state.searchTracks;
    else if (item?.id === 'fav-list') arr = state.favTracks;
    if (!arr || !t) return;
    const tt = arr[Number(el.dataset.idx)];
    if (tt && tt.source === t.source && tt.id === t.id) el.classList.add('playing');
  });
}

function updateMiniBar() {
  const t = player.current();
  if (!t) { $('minibar').classList.add('hidden'); return; }
  $('minibar').classList.remove('hidden');
  $('mb-title').textContent = t.title;
  $('mb-artist').textContent = t.artist || '未知歌手';
  $('mb-cover').src = proxyImg(t.cover);
  $('mb-disc').classList.toggle('spin', player.playing);
  $('mb-play').textContent = player.playing ? '❚❚' : '▶';
  $('mb-quality').textContent = player.lastQualityLabel || qualityText(state.quality);
}

function updatePlayerPage() {
  const t = player.current();
  if (!t) return;
  $('pi-title').textContent = t.title;
  $('pi-artist').textContent = t.artist || '未知歌手';
  $('pi-source').textContent = (t.source === 'bilibili' ? 'B站' : '音源') + ' · 正在播放';
  $('pi-collection').style.display = t.parentTitle || isCollection(t) ? 'inline-block' : 'none';
  $('pl-play').textContent = player.playing ? '❚❚' : '▶';
  $('pl-fav').textContent = state.favTracks.some((f) => f.source === t.source && f.id === t.id) ? '♥' : '♡';
  $('pl-fav').style.color = $('pl-fav').textContent === '♥' ? 'var(--gold)' : '';
  $('player-quality').textContent = player.lastQualityLabel || qualityText(state.quality);
  $('player-bg').style.backgroundImage = proxyImg(t.cover) ? `url("${proxyImg(t.cover)}")` : '';
  vinyl.setCover(proxyImg(t.cover));
  vinyl.setPlaying(player.playing);
  wave.setPlaying(player.playing);
  $('seek-dur').textContent = fmtTime(player.getDuration());
  updateProgress();
}

function updateProgress() {
  const dur = player.getDuration();
  const pos = player.getPosition();
  if ($('seek-bar') !== document.activeElement) {
    $('seek-bar').value = dur > 0 ? Math.round(pos / dur * 1000) : 0;
    const pct = dur > 0 ? (pos / dur * 100) : 0;
    $('seek-bar').style.background = `linear-gradient(90deg,var(--gold) ${pct}%,rgba(255,255,255,.12) ${pct}%)`;
  }
  $('seek-cur').textContent = fmtTime(pos);
  $('mb-progress-fill').style.width = (dur > 0 ? pos / dur * 100 : 0) + '%';
  // 用低频模拟频谱（无 WebAudio 分析时给个律动估值）
  const beat = player.playing ? (0.35 + 0.35 * Math.abs(Math.sin(performance.now() / 220))) : 0;
  vinyl.setBands(beat, beat * 0.6, beat * 0.3);
  wave.setEnergy(beat);
}

function qualityText(q) {
  if (q === Q.QUALITY_64K) return '标准 64K';
  if (q === Q.QUALITY_FLAC) return '无损 FLAC';
  return '高清 132K';
}

// ---------------- 视图切换 ----------------
function switchView(name) {
  state.currentView = name;
  document.querySelectorAll('.tb-tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
}

// ---------------- 数据加载 ----------------
async function loadFeed(reset = false) {
  if (state.loadingFeed) return;
  state.loadingFeed = true;
  $('feed-loading').style.display = 'block';
  if (reset) { await api.resetFeed(); state.feedTracks = []; }
  const r = await api.trending();
  if (r.ok) {
    if (r.data.errors.length) console.warn('推荐提示', r.data.errors);
    state.feedTracks.push(...r.data.tracks);
    renderList('feed-list', state.feedTracks, player.current()?.source + ':' + player.current()?.id);
    if (state.feedTracks.length === 0) toast('暂无推荐，请检查网络');
  } else toast('推荐加载失败：' + r.error);
  $('feed-loading').style.display = 'none';
  state.loadingFeed = false;
}

async function loadFavorites() {
  const r = await api.favorites();
  if (r.ok) {
    state.favTracks = r.data;
    renderList('fav-list', state.favTracks);
    $('fav-count').textContent = state.favTracks.length + ' 首';
    $('fav-empty').style.display = state.favTracks.length ? 'none' : 'block';
    // 收藏变化后刷新推荐画像
    await api.refreshProfile(state.favTracks);
  }
}

async function doSearch(q) {
  q = (q || '').trim();
  if (!q) return;
  $('search-input').value = q;
  $('search-empty').style.display = 'none';
  $('search-list').innerHTML = '<div class="feed-loading"><span class="spinner"></span>搜索中…</div>';
  const r = await api.search(q);
  if (r.ok) {
    state.searchTracks = r.data.tracks;
    if (r.data.errors.length) toast(r.data.errors[0]);
    renderList('search-list', state.searchTracks);
    if (!state.searchTracks.length) { $('search-list').innerHTML = ''; $('search-empty').style.display = 'block'; $('search-empty').textContent = '没有找到相关歌曲'; }
  } else toast('搜索失败：' + r.error);
}

// ---------------- 播放控制 ----------------
function playList(tracks, index, source) {
  if (!tracks.length) return;
  player.playQueue(tracks, index, source);
  openPlayer();
}
function openPlayer() { $('player').classList.remove('hidden'); }
function closePlayer() { $('player').classList.add('hidden'); }

async function toggleFav(t) {
  if (!t) return;
  const r = await api.toggleFav(t);
  if (r.ok) {
    toast(r.data ? '已加入收藏' : '已取消收藏');
    await loadFavorites();
    onPlayerState('track');
  }
}

async function showQualityMenu() {
  const m = $('quality-menu');
  m.classList.remove('hidden');
  m.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.q) === state.quality);
  });
}
async function switchQuality(q) {
  state.quality = q;
  await api.setSetting('quality', q);
  $('quality-menu').classList.add('hidden');
  if (player.current()) { await player.switchQuality(q); toast('已切换至 ' + qualityText(q)); }
}

async function showParts(t) {
  if (!t || !t.bvid) return;
  const r = await api.expand(t);
  if (r.ok && r.data && r.data.length >= 2) {
    const modal = $('parts-modal');
    $('parts-list').innerHTML = r.data.map((p, i) =>
      `<div class="part-item" data-i="${i}"><span class="part-num">${p.page}</span><span class="part-title">${esc(p.title)} — ${esc(p.artist)}</span><span class="part-dur">${fmtTime(p.durationMs)}</span></div>`
    ).join('');
    modal.classList.remove('hidden');
    modal._tracks = r.data;
    modal._source = t.parentTitle || 'parts';
  } else toast('该内容暂不可拆分为选集');
}

// ---------------- 事件绑定 ----------------
function bindEvents() {
  document.querySelectorAll('.tb-tab').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('win-min').onclick = () => api.minimize();
  $('win-max').onclick = () => api.maximize();
  $('win-close').onclick = () => api.close();
  $('btn-theme').onclick = async () => {
    const cur = await api.getSetting('theme', 'dark');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.body.classList.toggle('light', next === 'light');
    await api.setSetting('theme', next);
    toast(next === 'light' ? '已切换浅色主题' : '已切换深色主题');
  };
  document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', async () => {
    state.playMode = b.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === b));
    await api.setSetting('playMode', state.playMode);
  }));

  // 搜索
  $('search-btn').onclick = () => doSearch($('search-input').value);
  $('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch($('search-input').value); });
  const trends = ['抖音热歌 歌曲', '华语流行 歌曲', '经典老歌', '古风 歌曲', '周杰伦 歌曲', '轻音乐'];
  $('search-trend').innerHTML = '<span style="color:var(--dim);font-size:12px;align-self:center">热搜</span>' +
    trends.map((t) => `<button class="chip" data-q="${t}">${t}</button>`).join('');
  $('search-trend').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (b) doSearch(b.dataset.q);
  });
  $('feed-chips').innerHTML = trends.slice(0, 5).map((t) => `<button class="chip" data-q="${t}">${t}</button>`).join('');
  $('feed-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (b) { switchView('search'); doSearch(b.dataset.q); }
  });

  // 列表点击（事件委托）
  document.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      e.stopPropagation();
      const arr = arrOf(favBtn.closest('.track-list'));
      if (arr) toggleFav(arr[Number(favBtn.dataset.fav)]);
      return;
    }
    const item = e.target.closest('.track-item');
    if (item) {
      const arr = arrOf(item.closest('.track-list'));
      if (arr) playList(arr, Number(item.dataset.idx), arr === state.feedTracks ? 'feed' : arr === state.searchTracks ? 'search' : 'fav');
    }
  });
  function arrOf(el) {
    if (!el) return null;
    if (el.id === 'feed-list') return state.feedTracks;
    if (el.id === 'search-list') return state.searchTracks;
    if (el.id === 'fav-list') return state.favTracks;
    return null;
  }

  // 无限下拉
  $('feed-scroll').addEventListener('scroll', (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) loadFeed(false);
  });

  // 播放控制
  $('mb-play').onclick = () => player.toggle();
  $('mb-prev').onclick = () => player.previous();
  $('mb-next').onclick = () => player.next();
  $('mb-expand').onclick = openPlayer;
  $('mb-progress').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    player.seekTo((e.clientX - r.left) / r.width * player.getDuration());
  };
  $('mb-quality').onclick = showQualityMenu;
  $('player-close').onclick = closePlayer;
  $('pl-play').onclick = () => player.toggle();
  $('pl-prev').onclick = () => player.previous();
  $('pl-next').onclick = () => player.next();
  $('pl-fav').onclick = () => toggleFav(player.current());
  $('pl-mode').onclick = () => {
    const r = player.toggleRepeat();
    $('pl-mode').textContent = r ? '🔁' : '🔀';
    toast(r ? '单曲循环' : '随机播放');
  };
  $('player-quality').onclick = showQualityMenu;
  $('pi-collection').onclick = () => showParts(player.current());
  $('seek-bar').addEventListener('input', (e) => {
    const dur = player.getDuration();
    if (dur > 0) player.seekTo(Number(e.target.value) / 1000 * dur);
  });
  $('quality-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (b) switchQuality(Number(b.dataset.q));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#quality-menu') && !e.target.closest('#mb-quality') && !e.target.closest('#player-quality')) {
      $('quality-menu').classList.add('hidden');
    }
    if (e.target.id === 'parts-modal') $('parts-modal').classList.add('hidden');
  });
  $('parts-close').onclick = () => $('parts-modal').classList.add('hidden');
  $('parts-list').addEventListener('click', (e) => {
    const it = e.target.closest('[data-i]'); if (!it) return;
    const modal = $('parts-modal');
    playList(modal._tracks, Number(it.dataset.i), 'parts');
    modal.classList.add('hidden');
  });

  // 键盘：空格播放/暂停，上下切歌，Esc 收起
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); player.next(); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); player.previous(); }
    else if (e.code === 'Escape') {
      if (!$('parts-modal').classList.contains('hidden')) $('parts-modal').classList.add('hidden');
      else closePlayer();
    }
  });
  // 滚轮切歌（播放页）
  $('player').addEventListener('wheel', (e) => {
    if (e.deltaY > 0) player.next();
    else player.previous();
  }, { passive: true });
}

// ---------------- 动画循环 ----------------
function loop(now) {
  vinyl.tick(now);
  wave.tick();
  requestAnimationFrame(loop);
}

// ---------------- 启动 ----------------
async function init() {
  const pp = await api.proxyPort();
  if (pp.ok) state.proxyPort = pp.data;
  const q = await api.getSetting('quality', Q.QUALITY_132K);
  if (q.ok) state.quality = q.data;
  const theme = await api.getSetting('theme', 'dark');
  if (theme.ok) document.body.classList.toggle('light', theme.data === 'light');
  const pm = await api.getSetting('playMode', 'random');
  if (pm.ok) { state.playMode = pm.data; }

  player = new Player(api, onPlayerState);
  player.setProxyPort(state.proxyPort);
  player.quality = state.quality;
  player.setQuality(state.quality);
  $('mb-quality').textContent = qualityText(state.quality);

  vinyl = new VinylView($('vinyl-canvas'));
  wave = new WaveView($('wave-canvas'));
  wave.resize();
  window.addEventListener('resize', () => wave.resize());

  bindEvents();
  requestAnimationFrame(loop);

  await Promise.all([loadFavorites(), loadFeed(true)]);
  toast('小点声已就绪 · 点击歌曲开始聆听');
}

init().catch((e) => { console.error(e); toast('初始化失败：' + e.message); });
