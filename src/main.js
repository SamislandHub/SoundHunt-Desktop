/**
 * Electron 主进程
 * - 竖屏手机窗口（透明无边框、不在任务栏显示）
 * - 系统托盘：隐藏后继续播放，点击放大恢复
 * - 最小化 → 小巧迷你播放组件（可播放/暂停/切歌/恢复主窗）
 * - 状态栏右键菜单：置顶 / 最小化 / 隐藏 / 关闭
 * - IPC 桥接：搜索/推荐/播放地址/合集/收藏
 * - 网络层注入 Referer/UA：B站音频与封面直连
 */
import { app, BrowserWindow, ipcMain, session, screen, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BiliClient, QUALITY_64K, QUALITY_132K, QUALITY_FLAC } from './core/BiliClient.js';
import { SearchRepository } from './core/SearchRepository.js';
import { Store } from './core/Store.js';
import { makeTrack } from './core/Track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win = null;          // 主手机窗口
let miniWin = null;      // 迷你播放组件
let tray = null;         // 系统托盘
let store = null;
let repo = null;
let quitting = false;
let latestMiniState = { title: '小点声', artist: '', cover: '', playing: false, pos: 0, dur: 0 };

const DATA_DIR = path.join(app.getPath('userData'), 'soundhunt');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 允许自动播放（打开即播）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/** 给 B站 音频 / 图片请求注入 Referer + UA，绕过盗链拦截 */
function installHeaderInjector() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      try {
        const host = new URL(details.url).hostname;
        if (/bilibili|bilivideo|biliapi|biliintl|hdslb|biliimg|bilibiliapi/.test(host)) {
          details.requestHeaders['Referer'] = 'https://www.bilibili.com/';
          details.requestHeaders['Origin'] = 'https://www.bilibili.com';
          details.requestHeaders['User-Agent'] = UA;
        }
      } catch (e) { /* ignore */ }
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

/* ==================== 窗口 ==================== */
function createWindow() {
  const display = screen.getPrimaryDisplay();
  const availH = display.workAreaSize.height;
  // 窗口尺寸 = 机身实际尺寸（screen 434×940 + 四边边框 13px×2），严丝合缝，
  // 杜绝机身外的透明留白在 Windows 上被渲染成灰边
  const NATIVE_W = 460, NATIVE_H = 966;
  const scale = Math.min(1, (availH - 16) / NATIVE_H);
  win = new BrowserWindow({
    width: Math.round(NATIVE_W * scale),
    height: Math.round(NATIVE_H * scale),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,                 // 不在系统任务栏显示
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,     // 隐藏/最小化后继续播放
    },
  });
  win.center();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // 最小化 → 显示迷你播放组件；恢复 → 收起迷你组件
  win.on('minimize', () => { if (miniWin && !miniWin.isVisible()) showMini(); });
  win.on('restore', () => { if (miniWin && miniWin.isVisible()) miniWin.hide(); });
  win.on('hide', () => { if (miniWin && miniWin.isVisible()) miniWin.hide(); });
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); quitting = true; quitApp(); }
  });
}

/* ==================== 迷你播放组件 ==================== */
function createMini() {
  if (miniWin) return;
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  const W = 322, H = 76;
  miniWin = new BrowserWindow({
    width: W, height: H,
    x: Math.round(wa.x + wa.width - W - 18),
    y: Math.round(wa.y + wa.height - H - 22),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'mini-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  miniWin.loadFile(path.join(__dirname, 'renderer', 'mini.html'));
  miniWin.once('ready-to-show', () => { if (win?.isMinimized()) showMini(); });
  miniWin.on('close', (e) => { e.preventDefault(); miniWin.hide(); });
  miniWin.on('closed', () => { miniWin = null; });
}

function showMini() {
  if (!miniWin) createMini();
  miniWin.show();
  miniWin.webContents.send('mini-state', latestMiniState);
}

function restoreMain() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  if (miniWin && miniWin.isVisible()) miniWin.hide();
}

/* ==================== 系统托盘 ==================== */
function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'build', 'tray.png');
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.ico'));
    tray = new Tray(icon);
    tray.setToolTip('小点声 · 点击放大');
    // 左键点击：放大恢复主窗口
    tray.on('click', () => restoreMain());
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '放大窗口', click: () => restoreMain() },
      { label: '迷你播放条', click: () => { if (win) win.minimize(); } },
      { type: 'separator' },
      { label: '置顶', type: 'checkbox', checked: false, click: (item) => toggleTop(item.checked) },
      { type: 'separator' },
      { label: '退出小点声', click: () => { quitting = true; quitApp(); } },
    ]));
  } catch (e) { console.warn('托盘创建失败', e); }
}

function toggleTop(on) {
  if (!win) return;
  win.setAlwaysOnTop(!!on);
}

/** 状态栏右键菜单 */
function showStatusMenu() {
  if (!win) return;
  const top = win.isAlwaysOnTop();
  const menu = Menu.buildFromTemplate([
    { label: top ? '取消置顶' : '窗口置顶', click: () => toggleTop(!top) },
    { type: 'separator' },
    { label: '最小化到播放条', click: () => win.minimize() },
    { label: '隐藏到托盘（继续播放）', click: () => win.hide() },
    { type: 'separator' },
    { label: '关闭', click: () => { quitting = true; quitApp(); } },
  ]);
  menu.popup({ window: win });
}

function quitApp() {
  try { if (tray) { tray.destroy(); tray = null; } } catch (e) {}
  try { if (miniWin) { miniWin.destroy(); miniWin = null; } } catch (e) {}
  app.quit();
}

function registerIPC() {
  const ok = (data) => ({ ok: true, data });
  const fail = (e) => ({ ok: false, error: String((e && e.message) || e) });
  const wrap = (fn) => async (event, ...args) => { try { return ok(await fn(...args)); } catch (e) { return fail(e); } };

  ipcMain.handle('trending', wrap(() => repo.trending()));
  ipcMain.handle('search', wrap((q) => repo.search(q)));
  ipcMain.handle('expand', wrap((t) => repo.expand(makeTrack(t))));
  ipcMain.handle('playurl', wrap(async (t, q) => repo.bili.playCandidates(makeTrack(t), q || QUALITY_132K)));

  ipcMain.handle('favorites', wrap(() => store.favorites()));
  ipcMain.handle('toggle-fav', wrap((t) => store.toggleFavorite(makeTrack(t))));
  ipcMain.handle('is-fav', wrap((t) => store.isFavorite(makeTrack(t))));
  ipcMain.handle('refresh-profile', wrap((favs) => { repo.refreshProfile(favs.map(makeTrack)); return true; }));
  ipcMain.handle('reset-feed', wrap(() => { repo.resetFeedSession(); return true; }));

  ipcMain.handle('get-setting', wrap((key, def) => store.get(key, def)));
  ipcMain.handle('set-setting', wrap((key, val) => store.set(key, val)));
  ipcMain.handle('quality-constants', wrap(() => ({ QUALITY_64K, QUALITY_132K, QUALITY_FLAC })));
  ipcMain.handle('proxy-port', wrap(() => 0));

  // 状态栏右键菜单
  ipcMain.on('show-status-menu', () => showStatusMenu());
  // 自绘拖动：相对位移移动主窗口（避免 app-region:drag 吞掉右键菜单）
  ipcMain.on('win-drag-move', (e, dx, dy) => {
    if (!win || win.isMaximized()) return;
    const p = win.getPosition();
    win.setPosition(Math.round(p[0] + dx), Math.round(p[1] + dy));
  });
  ipcMain.on('win-minimize', () => win && win.minimize());
  ipcMain.on('win-hide', () => win && win.hide());
  ipcMain.on('win-close', () => { quitting = true; quitApp(); });

  // 主渲染进程 → 主进程：缓存并转发播放状态给迷你组件
  ipcMain.on('mini-state', (e, s) => {
    latestMiniState = s || latestMiniState;
    if (miniWin && miniWin.isVisible()) miniWin.webContents.send('mini-state', latestMiniState);
  });
  // 迷你组件 → 主进程 → 主渲染进程：播放控制
  ipcMain.on('mini-command', (e, cmd) => {
    if (win && !win.isDestroyed()) win.webContents.send('remote-command', cmd);
  });
  // 迷你组件 → 打开主窗口
  ipcMain.on('mini-open-main', () => restoreMain());
}

app.whenReady().then(async () => {
  store = new Store(DATA_DIR);
  repo = new SearchRepository();
  repo.refreshProfile(store.favorites());
  installHeaderInjector();
  registerIPC();
  createWindow();
  createMini();
  createTray();
});

app.on('activate', () => { if (!quitting) restoreMain(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.setAppUserModelId('com.soundhunt.desktop');
