'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ask', {
  submit: (text) => ipcRenderer.send('ask:submit', String(text || '')),
  hide: () => ipcRenderer.send('ask:hide'),
  onShow: (fn) => ipcRenderer.on('ask:show', () => fn()),
});
