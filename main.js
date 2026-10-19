'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const PROJECT_FILTERS = [{ name: 'Narrative Project', extensions: ['narrative'] }];

let win = null;
let currentFile = null;
let closeReady = false;

// ---------- settings (remembers the last opened project) ----------

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.error('Could not write settings', err);
  }
}

function defaultProjectFile() {
  return path.join(app.getPath('documents'), 'Narrative Organizer', 'My Narrative.narrative');
}

function setCurrentFile(file) {
  currentFile = file;
  writeSettings({ lastFile: file });
  if (win) win.setTitle(`${path.basename(file)} — Narrative Organizer`);
}

// ---------- file helpers ----------

function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function readProject(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fileFromArgs(argv) {
  const candidate = argv.slice(1).find((a) => a.toLowerCase().endsWith('.narrative'));
  return candidate && fs.existsSync(candidate) ? path.resolve(candidate) : null;
}

// ---------- IPC ----------

ipcMain.handle('project:load-initial', () => {
  const candidates = [fileFromArgs(process.argv), readSettings().lastFile, defaultProjectFile()];
  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      const data = readProject(file);
      setCurrentFile(file);
      return { path: file, data };
    } catch (err) {
      console.error('Could not read project', file, err);
    }
  }
  setCurrentFile(defaultProjectFile());
  return { path: currentFile, data: null };
});

ipcMain.handle('project:save', (_e, data) => {
  if (!currentFile) setCurrentFile(defaultProjectFile());
  try {
    writeFileAtomic(currentFile, JSON.stringify(data, null, 2));
    return { ok: true, path: currentFile };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open narrative',
    filters: PROJECT_FILTERS,
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const file = res.filePaths[0];
  try {
    const data = readProject(file);
    setCurrentFile(file);
    return { path: file, data };
  } catch (err) {
    dialog.showErrorBox('Could not open file', String(err && err.message ? err.message : err));
    return null;
  }
});

ipcMain.handle('project:save-as', async (_e, data, suggestedName) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Save narrative as',
    defaultPath: path.join(path.dirname(currentFile || defaultProjectFile()), `${suggestedName || 'My Narrative'}.narrative`),
    filters: PROJECT_FILTERS,
  });
  if (res.canceled || !res.filePath) return null;
  writeFileAtomic(res.filePath, JSON.stringify(data, null, 2));
  setCurrentFile(res.filePath);
  return { path: res.filePath };
});

ipcMain.handle('project:new', async () => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Create a new narrative',
    defaultPath: path.join(path.dirname(currentFile || defaultProjectFile()), 'New Narrative.narrative'),
    filters: PROJECT_FILTERS,
  });
  if (res.canceled || !res.filePath) return null;
  setCurrentFile(res.filePath);
  return { path: res.filePath };
});

ipcMain.handle('export:file', async (_e, { content, defaultName, filters }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters,
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, content, 'utf8');
  return { path: res.filePath };
});

ipcMain.handle('shell:show-file', () => {
  if (currentFile) shell.showItemInFolder(currentFile);
});

ipcMain.on('app:close-ready', () => {
  closeReady = true;
  if (win) win.close();
});

// ---------- window & menu ----------

function sendMenu(action) {
  if (win) win.webContents.send('menu', action);
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Narrative…', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendMenu('new-project') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('save-as') },
        { type: 'separator' },
        { label: 'Export Story as Text (.txt)…', click: () => sendMenu('export-txt') },
        { label: 'Export Story for WordPad (.rtf)…', click: () => sendMenu('export-rtf') },
        { label: 'Export Story as Markdown (.md)…', click: () => sendMenu('export-md') },
        { type: 'separator' },
        { label: 'Show Project File in Folder', click: () => currentFile && shell.showItemInFolder(currentFile) },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', click: () => sendMenu('undo') },
        { label: 'Redo', click: () => sendMenu('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'List', accelerator: 'CmdOrCtrl+1', click: () => sendMenu('view-list') },
        { label: 'Timeline', accelerator: 'CmdOrCtrl+2', click: () => sendMenu('view-timeline') },
        { label: 'Board', accelerator: 'CmdOrCtrl+3', click: () => sendMenu('view-board') },
        { label: 'Read', accelerator: 'CmdOrCtrl+4', click: () => sendMenu('view-read') },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Narrative Organizer',
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Keep "<file> — Narrative Organizer" instead of the page's <title>.
  win.on('page-title-updated', (e) => e.preventDefault());

  // Let the renderer flush any pending save before the window goes away.
  win.on('close', (e) => {
    if (closeReady) return;
    e.preventDefault();
    win.webContents.send('app:before-close');
    setTimeout(() => {
      closeReady = true;
      if (win) win.close();
    }, 2000);
  });

  win.on('closed', () => {
    win = null;
  });

  // Open external links in the user's browser rather than inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
