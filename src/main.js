/**
 * Electron 主进程
 * - 创建窗口
 * - IPC 桥接：把核心逻辑（搜索/推荐/播放地址/合集/收藏）暴露给渲染进程
 * - 音频流代理：B站音频需要 Referer，浏览器 <audio> 无法自定义 header，
 *   因此起一个本地 HTTP 服务做流代理，页面直接指向 http://127.0.0.1:端口/audio?u=...
 */
import { app, BrowserWindow, ipcMain, session } from 'electron';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BiliClient, QUALITY_64K, QUALITY_132K, QUALITY_FLAC, qualityLabel, readBody } from './core/BiliClient.js';
import { SearchRepository } from './core/SearchRepository.js';
import { Store } from './core/Store.js';
import { makeTrack } from './core/Track.js';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let win = null;
let store = null;
let repo = null;
let proxyServer = null;
let proxyPort = 0;

const DATA_DIR = path.join(app.getPath('userData'), 'soundhunt');

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    frame: false, // 自绘标题栏，沉浸式
    backgroundColor: '#080b11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

/** 本地音频流代理：给 B站音频请求加 Referer/UA，转发给 <audio> */
function startAudioProxy() {
  proxyServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/audio') {
        const target = url.searchParams.get('u');
        if (!target) { res.writeHead(400); return res.end('no url'); }
        const upstream = await readBody(target, {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Referer: 'https://www.bilibili.com/',
          Origin: 'https://www.bilibili.com',
        });
        res.writeHead(upstream.status, {
          'Content-Type': upstream.headers['content-type'] || 'audio/mp4',
          'Content-Length': upstream.body.length,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(upstream.body);
        return;
      }
      // 封面图代理（B站图片有防盗链）
      if (url.pathname === '/img') {
        const target = url.searchParams.get('u');
        if (!target) { res.writeHead(400); return res.end('no url'); }
        const upstream = await readBody(target, { Referer: 'https://www.bilibili.com/' });
        res.writeHead(upstream.status, {
          'Content-Type': upstream.headers['content-type'] || 'image/jpeg',
          'Content-Length': upstream.body.length,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(upstream.body);
        return;
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      res.writeHead(502); res.end(String(e.message || e));
    }
  });
  return new Promise((resolve) => {
    proxyServer.listen(0, '127.0.0.1', () => {
      proxyPort = proxyServer.address().port;
      resolve(proxyPort);
    });
  });
}

function registerIPC() {
  const ok = (data) => ({ ok: true, data });
  const fail = (e) => ({ ok: false, error: String(e && e.message || e) });
  const wrap = (fn) => async (...args) => { try { return ok(await fn(...args)); } catch (e) { return fail(e); } };

  ipcMain.handle('trending', wrap(() => repo.trending()));
  ipcMain.handle('search', wrap((q) => repo.search(q)));
  ipcMain.handle('expand', wrap((t) => repo.expand(makeTrack(t))));
  ipcMain.handle('playurl', wrap((t, q) => repo.bili.playCandidates(makeTrack(t), q || QUALITY_132K)));

  ipcMain.handle('favorites', wrap(() => store.favorites()));
  ipcMain.handle('toggle-fav', wrap((t) => store.toggleFavorite(makeTrack(t))));
  ipcMain.handle('is-fav', wrap((t) => store.isFavorite(makeTrack(t))));
  ipcMain.handle('refresh-profile', wrap((favs) => { repo.refreshProfile(favs.map(makeTrack)); return true; }));
  ipcMain.handle('reset-feed', wrap(() => { repo.resetFeedSession(); return true; }));

  ipcMain.handle('get-setting', wrap((key, def) => store.get(key, def)));
  ipcMain.handle('set-setting', wrap((key, val) => store.set(key, val)));
  ipcMain.handle('proxy-port', wrap(() => proxyPort));
  ipcMain.handle('quality-constants', wrap(() => ({ QUALITY_64K, QUALITY_132K, QUALITY_FLAC })));

  // 窗口控制（自绘标题栏）
  ipcMain.on('win-minimize', () => win && win.minimize());
  ipcMain.on('win-maximize', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  ipcMain.on('win-close', () => win && win.close());
}

app.whenReady().then(async () => {
  store = new Store(DATA_DIR);
  repo = new SearchRepository();
  repo.refreshProfile(store.favorites());
  await startAudioProxy();
  registerIPC();
  createWindow();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { if (proxyServer) proxyServer.close(); });

// 让渲染进程能显示系统媒体键（播放器媒体控制）
app.setAppUserModelId('com.soundhunt.desktop');
