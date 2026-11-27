/** 迷你播放组件的安全桥接 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniApi', {
  onState: (cb) => ipcRenderer.on('mini-state', (e, s) => cb(s)),
  command: (cmd) => ipcRenderer.send('mini-command', cmd),
  openMain: () => ipcRenderer.send('mini-open-main'),
});
