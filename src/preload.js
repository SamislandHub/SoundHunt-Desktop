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
  // 窗口控制
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close'),
});
