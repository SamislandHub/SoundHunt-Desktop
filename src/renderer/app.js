/** 小点声桌面版 —— 渲染进程总控（一比一复刻 Android 版 UI） */
import { Player, fmtTime } from './Player.js';
import { VinylView } from './visual.js';
import { isCollection } from '../core/Track.js';

const $ = (id) => document.getElementById(id);
const api = window.api;
const Q = { QUALITY_64K: 30216, QUALITY_132K: 30232, QUALITY_FLAC: 30280 };

const state = {
  feedTracks: [], searchTracks: [], favTracks: [],
  currentView: 'home', loadingFeed: false, showingSearch: false,
  quality: Q.QUALITY_132K, playMode: 'random', sortByName: false,
};

let player, homeVinyl, playVinyl;
let toastTimer = null;

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0112 6.6a4.7 4.7 0 018.5 2.6C20.5 15 12 20.5 12 20.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
const PLAY_TRI = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>';

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}
function proxyImg(url) { return url || ''; }
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isFav(t) { return !!t && state.favTracks.some((f) => f.source === t.source && f.id === t.id); }

/** 搜索页行：排名 + 圆形黑胶缩略图 + 标题/作者 + 收藏 + 播放 */
function searchRowHTML(t, idx, playingId) {
  const fav = isFav(t);
  const top = idx < 3 ? ' top' : '';
  const playing = t.stableIdKey === playingId;
  return `<div class="track-item${playing ? ' playing' : ''}" data-idx="${idx}">
    <i class="ti-rank serif${top}">${String(idx + 1).padStart(2, '0')}</i>
    <div class="disc-thumb" data-cover="${esc(t.cover)}">
      <div class="dt-grooves"></div><div class="dt-label"></div>
    </div>
    <div class="ti-meta">
      <div class="ti-title">${esc(t.title)}</div>
      <div class="ti-artist">${esc(t.artist || '未知歌手')}${isCollection(t) ? ' · 合集' : ''}</div>
    </div>
    <div class="ti-actions">
      <button class="ti-fav${fav ? ' on' : ''}" data-fav="${idx}" aria-label="收藏">${HEART}</button>
      <button class="ti-play" data-play="${idx}" aria-label="播放">${PLAY_TRI}</button>
    </div>
  </div>`;
}

/** 收藏页行：圆形黑胶缩略图 + 标题/作者 + 实心收藏 */
function favRowHTML(t, idx, playingId) {
  const playing = t.stableIdKey === playingId;
  return `<div class="track-item${playing ? ' playing' : ''}" data-idx="${idx}">
    <div class="disc-thumb" data-cover="${esc(t.cover)}">
      <div class="dt-grooves"></div><div class="dt-label"></div>
    </div>
    <div class="ti-meta">
      <div class="ti-title">${esc(t.title)}</div>
      <div class="ti-artist">${esc(t.artist || '未知歌手')}</div>
    </div>
    <div class="ti-actions">
      <button class="ti-fav on" data-fav="${idx}" aria-label="移出收藏">${HEART}</button>
    </div>
  </div>`;
}

/** 给所有缩略图套上封面背景（Referer 由主进程注入，background-image 同样生效） */
function paintCovers(root) {
  root.querySelectorAll('.disc-thumb[data-cover]').forEach((el) => {
    const url = proxyImg(el.dataset.cover);
    const label = el.querySelector('.dt-label');
    if (url && label) label.style.backgroundImage = `url("${url}")`;
  });
}

function renderList(containerId, tracks, playingId, kind) {
  const el = $(containerId);
  el.innerHTML = tracks.map((t, i) => {
    t.stableIdKey = t.source + ':' + t.id;
    return kind === 'fav' ? favRowHTML(t, i, playingId) : searchRowHTML(t, i, playingId);
  }).join('');
  paintCovers(el);
}

// ---------------- 播放状态同步 ----------------
/** 把当前播放状态推送给主进程，供迷你组件/托盘显示 */
function pushMiniState() {
  const t = player.current();
  api.pushMiniState({
    title: t ? t.title : '小点声',
    artist: t ? (t.artist || '未知歌手') : '点击放大',
    cover: t ? proxyImg(t.cover) : '',
    playing: !!player.playing,
    pos: player.getPosition(),
    dur: player.getDuration(),
  });
}

function onPlayerState(kind) {
  const t = player.current();
  if (kind === 'progress') { updateProgress(); return; }
  updateMiniBar();
  updatePlayerPage();
  pushMiniState();
  const playingId = t ? t.source + ':' + t.id : null;
  document.querySelectorAll('.track-item').forEach((el) => {
    el.classList.remove('playing');
    const item = el.closest('.track-list');
    let arr = null;
    if (item?.id === 'search-list') arr = state.searchTracks;
    else if (item?.id === 'fav-list') arr = state.favTracks;
    if (!arr || !t) return;
    const tt = arr[Number(el.dataset.idx)];
    if (tt && tt.stableIdKey === playingId) el.classList.add('playing');
  });
  // 列表项封面不旋转（仅下方迷你播放胶囊随播放旋转）
}

function updateMiniBar() {
  const t = player.current();
  const show = !!t && (state.currentView === 'search' || state.currentView === 'favorites');
  $('minibar').classList.toggle('hidden', !show);
  if (!t) return;
  $('mb-title').textContent = t.title;
  $('mb-artist').textContent = t.artist || '未知歌手';
  const label = $('mb-cover');
  const url = proxyImg(t.cover);
  label.style.backgroundImage = url ? `url("${url}")` : '';
  $('mb-disc').classList.toggle('spin', player.playing);
  $('mb-play').classList.toggle('paused', !player.playing);
  // 首页沉浸信息
  $('hm-title').textContent = t.title;
  $('hm-artist').textContent = t.artist || '未知歌手';
  $('hm-fav').classList.toggle('on', isFav(t));
}

function updatePlayerPage() {
  const t = player.current();
  if (!t) return;
  $('pi-title').textContent = t.title;
  $('pi-artist').textContent = t.artist || '未知歌手';
  $('pi-source').textContent = '来自 · ' + (t.source === 'bilibili' ? 'B站' : '音源');
  $('pl-play').classList.toggle('paused', !player.playing);
  const faved = isFav(t);
  const fbtn = $('pl-fav');
  fbtn.classList.toggle('on', faved);
  fbtn.innerHTML = HEART;
  const cover = proxyImg(t.cover);
  $('player-bg').style.backgroundImage = cover ? `url("${cover}")` : '';
  [homeVinyl, playVinyl].forEach((v) => {
    if (!v) return;
    v.setCover(cover);
    v.setTrack((t.source || 'bilibili') + ':' + (t.id || ''));
    v.setPlaying(player.playing);
  });
  $('seek-dur').textContent = fmtTime(player.getDuration());
  $('home-center-play').style.display = player.playing ? 'none' : 'flex';
  // 选集入口：与 Android updateTrack 一致——来自拆分合集(page>0)、有合集名、且队列>1
  const collection = !!(t.parentTitle && t.page > 0 && player.queue.length > 1);
  $('episode-row').classList.toggle('hidden', !collection);
  if (collection) {
    $('episode-name').textContent = t.parentTitle;
    $('episode-index').textContent = `第 ${player.index + 1} / ${player.queue.length} 集`;
  }
  updateProgress();
}

function updateProgress() {
  const dur = player.getDuration();
  const pos = player.getPosition();
  if ($('seek-bar') !== document.activeElement) {
    $('seek-bar').value = dur > 0 ? Math.round(pos / dur * 1000) : 0;
    const pct = dur > 0 ? (pos / dur * 100) : 0;
    $('seek-bar').style.background = `linear-gradient(90deg,var(--gold) ${pct}%,var(--line) ${pct}%)`;
  }
  $('seek-cur').textContent = fmtTime(pos);
  $('mb-progress-fill').style.width = (dur > 0 ? pos / dur * 100 : 0) + '%';
  // 转速由黑胶内部 ticker 按节拍/音调自转，不再用高频假频谱喂入（避免又抖又快）
  // 进度推送给迷你组件（仅迷你组件可见时主进程才会转发，开销可忽略）
  const ct = player.current();
  api.pushMiniState({
    title: ct ? ct.title : '小点声', artist: ct ? (ct.artist || '未知歌手') : '点击放大',
    cover: ct ? proxyImg(ct.cover) : '', playing: !!player.playing, pos, dur,
  });
}

function qualityText(q) {
  if (q === Q.QUALITY_64K) return '标准 64K';
  if (q === Q.QUALITY_FLAC) return '无损 FLAC';
  return '高清 132K';
}

// ---------------- 视图切换 ----------------
function switchView(name) {
  state.currentView = name;
  $('screen').dataset.view = name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.page').forEach((v) => v.classList.toggle('active', v.id === 'page-' + name));
  $('tab-indicator').style.left = name === 'favorites' ? '75%' : '25%';
  updateMiniBar();
}

// ---------------- 数据加载 ----------------
async function loadFeed(reset = false) {
  if (state.loadingFeed) return;
  state.loadingFeed = true;
  if (reset) { await api.resetFeed(); state.feedTracks = []; }
  const r = await api.trending();
  if (r.ok) {
    if (r.data.errors.length) console.warn('推荐提示', r.data.errors);
    state.feedTracks.push(...r.data.tracks);
    if (state.feedTracks.length === 0) toast('暂无推荐，请检查网络');
    if (player && player.queue.length && player.queueSource === 'feed') player.appendQueue(r.data.tracks);
    if (!state.showingSearch) renderSearchFeed();
  } else toast('推荐加载失败：' + r.error);
  state.loadingFeed = false;
}

function renderSearchFeed() {
  $('feed-section-title').textContent = '为你推荐';
  $('refresh-label').textContent = '换一批';
  $('feed-status').textContent = 'B站公开音源 · 实时更新';
  renderList('search-list', state.feedTracks, player?.current()?.stableIdKey, 'feed');
  $('search-empty').classList.remove('show');
}

async function loadFavorites() {
  const r = await api.favorites();
  if (r.ok) {
    let list = r.data;
    if (state.sortByName) list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh'));
    state.favTracks = list;
    renderList('fav-list', state.favTracks, player?.current()?.stableIdKey, 'fav');
    $('fav-count').textContent = state.favTracks.length + ' 首';
    $('fav-empty').classList.toggle('show', state.favTracks.length === 0);
    await api.refreshProfile(state.favTracks);
    if (state.currentView === 'favorites') updateMiniBar();
  }
}

async function doSearch(q) {
  q = (q || '').trim();
  if (!q) { toast('先输入歌名或歌手'); return; }
  $('search-input').value = q;
  state.showingSearch = true;
  $('search-empty').classList.remove('show');
  $('search-list').innerHTML = '<div class="empty-hint show">搜索中…</div>';
  const r = await api.search(q);
  if (r.ok) {
    state.searchTracks = r.data.tracks;
    if (r.data.errors.length) toast(r.data.errors[0]);
    $('feed-section-title').textContent = '搜索结果';
    $('refresh-label').textContent = '返回推荐';
    $('feed-status').textContent = state.searchTracks.length ? `找到 ${state.searchTracks.length} 条` : '没有找到结果，换个词试试';
    renderList('search-list', state.searchTracks, player?.current()?.stableIdKey, 'feed');
    if (!state.searchTracks.length) $('search-empty').classList.add('show');
  } else toast('搜索失败：' + r.error);
}

// ---------------- 播放控制 ----------------
async function playList(tracks, index, source, options = {}) {
  if (!tracks.length) return;
  const { open = true, silent = false } = options;
  const target = tracks[index];
  if (source === 'feed') state.showingSearch = false;
  // 与 Android 版 expandAndPlay 一致：B站条目先尝试展开多 P 合集为单曲队列，
  // 展开失败（单 P / 网络失败）则原样播放整段。
  if (target && target.source === 'bilibili' && target.bvid) {
    const r = await api.expand(target);
    if (r.ok && r.data && r.data.length >= 2) {
      player.playQueue(r.data, 0, source);
      if (open) openPlayer();
      if (!silent) toast('已展开合集：共 ' + r.data.length + ' 首');
      return;
    }
  }
  player.playQueue(tracks, index, source);
  if (open) openPlayer();
}
function openPlayer() { $('player').classList.remove('hidden'); }
function closePlayer() { $('player').classList.add('hidden'); }

async function toggleFav(t) {
  if (!t) return;
  const r = await api.toggleFav(t);
  if (r.ok) {
    toast(r.data ? '已加入我的收藏' : '已移出收藏');
    await loadFavorites();
    onPlayerState('track');
  }
}

function showQualityMenu() {
  const m = $('quality-menu');
  m.classList.remove('hidden');
  m.querySelectorAll('button').forEach((b) => b.classList.toggle('active', Number(b.dataset.q) === state.quality));
}
async function switchQuality(q) {
  state.quality = q;
  await api.setSetting('quality', q);
  $('quality-menu').classList.add('hidden');
  if (player.current()) { await player.switchQuality(q); toast('音质已设为 ' + qualityText(q)); }
}

function showParts() {
  // 与 Android 的 showEpisodeSheet 一致：直接列出当前播放队列，当前集高亮，点选就地切歌
  const queue = player.queue;
  const cur = player.current();
  if (!cur || !cur.parentTitle || queue.length < 2) return;
  $('parts-title').textContent = cur.parentTitle;
  $('parts-sub').textContent = `共 ${queue.length} 集 · 点选任意一集播放`;
  $('parts-list').innerHTML = queue.map((p, i) => {
    const active = i === player.index;
    return `<div class="part-item${active ? ' active' : ''}" data-i="${i}">`
      + `<span class="part-num">${String(i + 1).padStart(2, '0')}</span>`
      + `<div class="part-main"><div class="part-title">${esc(p.title)}</div>`
      + `<div class="part-artist">${esc(p.artist || '')}</div></div>`
      + `<span class="part-dur">${fmtTime(p.durationMs)}</span>`
      + (active ? '<span class="part-playing">▶</span>' : '')
      + `</div>`;
  }).join('');
  const modal = $('parts-modal');
  modal.classList.remove('hidden');
  // 滚动到当前集附近
  const activeEl = $('parts-list').querySelector('.part-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'center' });
}

// ---------------- 拖动 & 手势 ----------------
/** 状态栏自绘拖动：左键按住拖动移动窗口，右键不受影响照常弹菜单。
 *  Electron 的 -webkit-app-region:drag 会吞掉右键 contextmenu，故不用它。 */
function bindDragbar() {
  const bar = $('statusbar');
  let dragging = false, lastX = 0, lastY = 0;
  bar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;           // 只响应左键；右键交给 contextmenu
    dragging = true; lastX = e.screenX; lastY = e.screenY;
    bar.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.screenX - lastX, dy = e.screenY - lastY;
    lastX = e.screenX; lastY = e.screenY;
    api.dragMove(dx, dy);
  });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; bar.classList.remove('dragging'); } });
}

/** 竖直滑动切歌：与 Android SwipeLayer 一致——阈值 84px，上滑下一首、下滑上一首。
 *  只在明显竖滑（|dy|>|dx|）时触发，避免影响点击。 */
function bindSwipe(el, enabled) {
  if (!el) return;
  const THRESHOLD = 84;
  let dy = 0, dx = 0, downY = 0, downX = 0, active = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (enabled && !enabled())) return;
    active = true; downX = e.clientX; downY = e.clientY; dx = 0; dy = 0;
  }, { passive: true });
  el.addEventListener('pointermove', (e) => {
    if (!active) return;
    dx = e.clientX - downX; dy = e.clientY - downY;
  }, { passive: true });
  const finish = () => {
    if (!active) return;
    active = false;
    if (Math.abs(dy) > THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
      el._swipeUntil = Date.now() + 400; // 抑制滑动后紧跟的 click，避免切歌又被当成点按 toggle
      if (dy < 0) { playSwapAnim(el); player.next(); }
      else { playSwapAnim(el); player.previous(); }
    }
    dx = 0; dy = 0;
  };
  el.addEventListener('pointerup', finish, { passive: true });
  el.addEventListener('pointercancel', () => { active = false; }, { passive: true });
}
/** 切歌时舞台轻微位移淡入（对齐 Android playSwapAnimation） */
function playSwapAnim(el) {
  el.animate(
    [{ opacity: 0.55, transform: 'translateY(0)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 240, easing: 'ease-out' }
  );
}

// ---------------- 事件绑定 ----------------
function bindEvents() {
  // 状态栏右键菜单：置顶 / 最小化 / 隐藏 / 关闭
  $('statusbar').addEventListener('contextmenu', (e) => { e.preventDefault(); api.showStatusMenu(); });
  // 状态栏左键拖动（自绘，不吞右键）
  bindDragbar();

  // 远程控制（迷你组件 / 托盘）
  api.onRemoteCommand((cmd) => {
    if (!player) return;
    if (cmd === 'toggle') player.toggle();
    else if (cmd === 'next') player.next();
    else if (cmd === 'prev') player.previous();
  });

  // 底部导航（首页/收藏）
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('search-back').onclick = () => switchView('home');

  // 收藏工具行
  $('fav-mode-sort').onclick = async () => {
    state.sortByName = !state.sortByName;
    $('fav-sort-label').textContent = state.sortByName ? '按歌名' : '按添加时间';
    await loadFavorites();
    toast(state.sortByName ? '按歌名排序' : '按添加时间排序');
  };
  $('fav-mode-random').onclick = async () => {
    const tracks = [...state.favTracks];
    if (!tracks.length) { toast('还没有收藏'); return; }
    for (let i = tracks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; }
    playList(tracks, 0, 'fav');
    toast('随机播放');
  };
  $('fav-settings').onclick = async () => {
    const light = document.body.classList.toggle('light');
    await api.setSetting('theme', light ? 'light' : 'dark');
    toast(light ? '已切换浅色主题' : '已切换深色主题');
  };

  // 首页搜索栏 → 搜索页
  $('home-search').onclick = () => { switchView('search'); setTimeout(() => $('search-input').focus(), 60); };
  $('search-btn').onclick = () => doSearch($('search-input').value);
  $('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch($('search-input').value); });
  const HOT = ['抖音热歌', '稻香', '周杰伦', '治愈纯音', 'Lo-fi', '古风', '粤语经典', 'Taylor Swift', '华语流行'];
  $('search-trend').innerHTML = HOT.map((t, i) => `<button class="chip${i === 0 ? ' active' : ''}" data-q="${t}">${t}</button>`).join('');
  $('search-trend').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    $('search-trend').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
    doSearch(b.dataset.q);
  });
  $('refresh-feed').onclick = async () => {
    if (state.showingSearch) {
      state.showingSearch = false;
      $('search-input').value = '';
      renderSearchFeed();
      toast('返回推荐');
    } else {
      state.feedTracks = [];
      await loadFeed(true);
      toast('已换一批推荐');
    }
  };

  // 首页沉浸区：轻点舞台/黑胶 = 播放/暂停（对齐 Android stage.setOnClickListener→service.toggle），不跳播放页
  // 进入播放页只靠底部迷你播放条 minibar（对齐 Android 的 mini bar）
  $('home-vinyl').onclick = () => {
    if (Date.now() < ($('home-stage')._swipeUntil || 0)) return; // 滑动切歌后不误触发
    if (player.current()) player.toggle();
  };
  $('home-center-play').onclick = (e) => { e.stopPropagation(); if (player.current()) player.toggle(); };
  // 点歌名/歌手区进入播放页（首页唯一进播放页入口，对齐 Android 从迷你条/列表进 PlayerActivity）
  $('hm-text').onclick = () => { if (player.current()) openPlayer(); };
  $('home-stage').addEventListener('wheel', (e) => {
    if (!player.current()) return;
    e.preventDefault();
    if (e.deltaY > 0) player.next(); else player.previous();
  }, { passive: false });
  // 首页上下滑切歌（对齐 Android SwipeLayer）：点黑胶开播放页、点播放键仍正常
  bindSwipe($('home-stage'), () => !!player.current());
  $('hm-fav').onclick = () => toggleFav(player.current());

  // 列表点击（事件委托）
  document.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      e.stopPropagation();
      const arr = arrOf(favBtn.closest('.track-list'));
      if (arr) toggleFav(arr[Number(favBtn.dataset.fav)]);
      return;
    }
    const playBtn = e.target.closest('[data-play]');
    if (playBtn) {
      e.stopPropagation();
      const list = playBtn.closest('.track-list');
      const arr = arrOf(list);
      if (arr) playList(arr, Number(playBtn.dataset.play), list.id === 'search-list' && state.showingSearch ? 'search' : 'feed');
      return;
    }
    const item = e.target.closest('.track-item');
    if (item) {
      const list = item.closest('.track-list');
      const arr = arrOf(list);
      if (!arr) return;
      if (list?.id === 'fav-list') playList(arr, Number(item.dataset.idx), 'fav');
      else playList(arr, Number(item.dataset.idx), state.showingSearch ? 'search' : 'feed');
    }
  });
  function arrOf(el) {
    if (!el) return null;
    if (el.id === 'search-list') return state.showingSearch ? state.searchTracks : state.feedTracks;
    if (el.id === 'fav-list') return state.favTracks;
    return null;
  }

  // 迷你播放条
  $('minibar').onclick = (e) => { if (!e.target.closest('.mb-play') && !e.target.closest('.mb-next')) openPlayer(); };
  $('mb-play').onclick = (e) => { e.stopPropagation(); player.toggle(); };
  $('mb-next').onclick = (e) => { e.stopPropagation(); player.next(); };

  // 播放页控制
  $('player-back').onclick = closePlayer;
  $('pl-play').onclick = () => player.toggle();
  $('pl-prev').onclick = () => player.previous();
  $('pl-next').onclick = () => player.next();
  $('pl-fav').onclick = () => toggleFav(player.current());
  $('pl-shuffle').onclick = () => {
    const r = player.toggleRepeat();
    $('pl-shuffle').classList.toggle('on', !r);
    toast(r ? '单曲循环 · 开' : '随机播放');
  };
  $('pl-repeat').onclick = () => {
    const r = player.toggleRepeat();
    $('pl-repeat').classList.toggle('on', r);
    toast(r ? '单曲循环 · 开' : '单曲循环 · 关');
  };
  $('player-more').onclick = showQualityMenu;
  $('episode-row').onclick = showParts;
  $('seek-bar').addEventListener('input', (e) => {
    const dur = player.getDuration();
    if (dur > 0) player.seekTo(Number(e.target.value) / 1000 * dur);
  });
  $('quality-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (b) switchQuality(Number(b.dataset.q));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#quality-menu') && !e.target.closest('#player-more')) $('quality-menu').classList.add('hidden');
    if (e.target.id === 'parts-modal') $('parts-modal').classList.add('hidden');
  });
  $('parts-close').onclick = () => $('parts-modal').classList.add('hidden');
  $('parts-list').addEventListener('click', (e) => {
    const it = e.target.closest('[data-i]'); if (!it) return;
    const i = Number(it.dataset.i);
    const cur = player.current();
    if (cur && cur.parentTitle && i !== player.index) {
      player.playAt(i);
      toast('已跳转到第 ' + (i + 1) + ' 集');
    }
    $('parts-modal').classList.add('hidden');
  });

  // 键盘
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); player.next(); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); player.previous(); }
    else if (e.code === 'Escape') {
      if (!$('parts-modal').classList.contains('hidden')) $('parts-modal').classList.add('hidden');
      else if (!$('player').classList.contains('hidden')) closePlayer();
      else if (state.currentView !== 'home') switchView('home');
    }
  });
  $('player').addEventListener('wheel', (e) => {
    if (e.deltaY > 0) player.next(); else player.previous();
  }, { passive: true });
  // 播放页上下滑切歌；选集弹层打开时不切（对齐 Android onSwipe 的 sheetShown 判断）
  bindSwipe($('player'), () => $('parts-modal').classList.contains('hidden') && !!player.current());
}

// ---------------- 动画循环 ----------------
function loop(now) {
  if (homeVinyl) homeVinyl.tick(now);
  if (playVinyl) playVinyl.tick(now + 500);
  requestAnimationFrame(loop);
}

function startClock() {
  const tick = () => {
    const d = new Date();
    $('sb-time').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  tick();
  setInterval(tick, 10000);
}

// ---------------- 启动 ----------------
async function init() {
  const q = await api.getSetting('quality', Q.QUALITY_132K);
  if (q.ok) state.quality = q.data;
  const theme = await api.getSetting('theme', 'dark');
  if (theme.ok) document.body.classList.toggle('light', theme.data === 'light');
  const pm = await api.getSetting('playMode', 'random');
  if (pm.ok) state.playMode = pm.data;

  player = new Player(api, onPlayerState);
  player.quality = state.quality;
  player.setQuality(state.quality);

  homeVinyl = new VinylView($('home-vinyl'));
  playVinyl = new VinylView($('vinyl-canvas'));
  homeVinyl.dpr = $('home-vinyl').width / 760;
  playVinyl.dpr = $('vinyl-canvas').width / 760;
  startClock();
  bindEvents();
  switchView('home');
  requestAnimationFrame(loop);

  await Promise.all([loadFavorites(), loadFeed(true)]);
  // 打开即播：走 playList（与点播同一条路径），B站合集条目会先展开为单曲队列，
  // 这样播放页选集入口/合集功能从第一首就可用，而不是绕过展开逻辑。
  if (state.feedTracks.length) await playList(state.feedTracks, 0, 'feed', { open: false, silent: true });
  onPlayerState('track');
}

init().catch((e) => { console.error(e); toast('初始化失败：' + e.message); });
