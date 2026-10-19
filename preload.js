'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('narrativeAPI', {
  isDesktop: true,
  loadInitial: () => ipcRenderer.invoke('project:load-initial'),
  save: (data) => ipcRenderer.invoke('project:save', data),
  open: () => ipcRenderer.invoke('project:open'),
  saveAs: (data, suggestedName) => ipcRenderer.invoke('project:save-as', data, suggestedName),
  newProject: () => ipcRenderer.invoke('project:new'),
  exportFile: (content, defaultName, filters) => ipcRenderer.invoke('export:file', { content, defaultName, filters }),
  showFile: () => ipcRenderer.invoke('shell:show-file'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  onBeforeClose: (cb) => ipcRenderer.on('app:before-close', () => cb()),
  closeReady: () => ipcRenderer.send('app:close-ready'),
});
