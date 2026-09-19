// preload.js —— 自检页与主进程的唯一通道(contextIsolation 标准形态,与 GenOffice 7 组 preload API 同构)
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('selfcheck', {
  run: (id) => ipcRenderer.invoke(`selfcheck:${id}`),
})
