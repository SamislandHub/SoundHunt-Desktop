/**
 * Electron 主进程
 * - 竖屏手机窗口
 * - IPC 桥接：搜索/推荐/播放地址/合集/收藏
 * - 网络层注入 Referer/UA：B站音频与封面直连（浏览器原生流式播放，支持拖动进度）
 */
import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BiliClient, QUALITY_64K, QUALITY_132K, QUALITY_FLAC } from './core/BiliClient.js';
import { SearchRepository } from './core/SearchRepository.js';
import { Store } from './core/Store.js';
import { makeTrack } from './core/Track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win = null;
let store = null;
let repo = null;

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

function createWindow() {
  win = new BrowserWindow({
    width: 430,
    height: 900,
    minWidth: 400,
    minHeight: 720,
    frame: false,               // 无系统标题栏，UI 内自绘手机状态栏
    backgroundColor: '#080a0e',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function registerIPC() {
  const ok = (data) => ({ ok: true, data });
  const fail = (e) => ({ ok: false, error: String((e && e.message) || e) });
  // ipcMain.handle 回调第一个参数是 event，需跳过后再传给业务函数
  const wrap = (fn) => async (event, ...args) => { try { return ok(await fn(...args)); } catch (e) { return fail(e); } };

  ipcMain.handle('trending', wrap(() => repo.trending()));
  ipcMain.handle('search', wrap((q) => repo.search(q)));
  ipcMain.handle('expand', wrap((t) => repo.expand(makeTrack(t))));
  ipcMain.handle('playurl', wrap(async (t, q) => {
    return repo.bili.playCandidates(makeTrack(t), q || QUALITY_132K);
  }));

  ipcMain.handle('favorites', wrap(() => store.favorites()));
  ipcMain.handle('toggle-fav', wrap((t) => store.toggleFavorite(makeTrack(t))));
  ipcMain.handle('is-fav', wrap((t) => store.isFavorite(makeTrack(t))));
  ipcMain.handle('refresh-profile', wrap((favs) => { repo.refreshProfile(favs.map(makeTrack)); return true; }));
  ipcMain.handle('reset-feed', wrap(() => { repo.resetFeedSession(); return true; }));

  ipcMain.handle('get-setting', wrap((key, def) => store.get(key, def)));
  ipcMain.handle('set-setting', wrap((key, val) => store.set(key, val)));
  ipcMain.handle('quality-constants', wrap(() => ({ QUALITY_64K, QUALITY_132K, QUALITY_FLAC })));

  // 兼容旧调用：不再需要本地代理
  ipcMain.handle('proxy-port', wrap(() => 0));

  // 窗口控制
  ipcMain.on('win-minimize', () => win && win.minimize());
  ipcMain.on('win-maximize', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  ipcMain.on('win-close', () => win && win.close());
}

app.whenReady().then(async () => {
  store = new Store(DATA_DIR);
  repo = new SearchRepository();
  repo.refreshProfile(store.favorites());
  installHeaderInjector();
  registerIPC();
  createWindow();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.setAppUserModelId('com.soundhunt.desktop');
