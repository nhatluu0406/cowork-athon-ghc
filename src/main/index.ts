import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc';

let mainWin: BrowserWindow | null = null;

function createWindow(): void {
  const isMac = process.platform === 'darwin';

  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    frame: isMac,
    backgroundColor: '#FAF8F3',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWin.webContents.on('dom-ready', () => {
    mainWin?.webContents.send('platform', process.platform);
  });

  mainWin.on('closed', () => {
    mainWin = null;
  });

  registerIpcHandlers(mainWin);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
