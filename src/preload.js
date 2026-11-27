/** 安全桥接：只暴露必要的 IPC 方法给渲染进程 */
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  trending: () => call('trending'),
  search: (q) => call('search', q),
  expand: (t) => call('expand', t),
  playurl: (t, q) => call('playurl', t, q),
  favorites: () => call('favorites'),
  toggleFav: (t) => call('toggle-fav', t),
  isFav: (t) => call('is-fav', t),
  refreshProfile: (favs) => call('refresh-profile', favs),
  resetFeed: () => call('reset-feed'),
  getSetting: (k, d) => call('get-setting', k, d),
  setSetting: (k, v) => call('set-setting', k, v),
  proxyPort: () => call('proxy-port'),
  qualityConstants: () => call('quality-constants'),
  // 窗口 / 系统级控制
  minimize: () => ipcRenderer.send('win-minimize'),
  hide: () => ipcRenderer.send('win-hide'),
  close: () => ipcRenderer.send('win-close'),
  showStatusMenu: () => ipcRenderer.send('show-status-menu'),
  // 自绘拖动：渲染层按住状态栏拖动，主进程按相对位移移动窗口
  dragMove: (dx, dy) => ipcRenderer.send('win-drag-move', dx, dy),
  // 推送播放状态给迷你组件
  pushMiniState: (s) => ipcRenderer.send('mini-state', s),
  // 接收迷你组件/托盘的远程控制
  onRemoteCommand: (cb) => ipcRenderer.on('remote-command', (e, cmd) => cb(cmd)),
});
