import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { StreamEvent } from '../main/agent/types';

contextBridge.exposeInMainWorld('coworkAPI', {
  platform: process.platform,

  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  onPlatform: (cb: (platform: string) => void) => ipcRenderer.on('platform', (_e, p) => cb(p)),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),

  send: (conversationId: string, text: string, attachmentPaths?: string[]) =>
    ipcRenderer.invoke('cowork:send', conversationId, text, attachmentPaths ?? []),
  pickAttachments: () => ipcRenderer.invoke('attachment:pick'),
  savePastedImage: (base64Png: string) => ipcRenderer.invoke('attachment:savePastedImage', base64Png),
  // Electron ≥32 removed File.path from the renderer; webUtils in the preload is
  // the supported way to resolve a dragged/pasted File back to its disk path.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  cancel: (conversationId: string, messageId: string) => ipcRenderer.invoke('cowork:cancel', conversationId, messageId),
  compress: (conversationId: string) => ipcRenderer.invoke('cowork:compress', conversationId),
  onEvent: (cb: (messageId: string, event: StreamEvent) => void) =>
    ipcRenderer.on('cowork:event', (_e, messageId, event) => cb(messageId, event)),

  historyList: () => ipcRenderer.invoke('history:list'),
  historyLoad: (sessionId: string) => ipcRenderer.invoke('history:load', sessionId),
  historyNew: () => ipcRenderer.invoke('history:new'),
  historyRename: (sessionId: string, title: string) => ipcRenderer.invoke('history:rename', sessionId, title),
  historyPin: (sessionId: string, pinned: boolean) => ipcRenderer.invoke('history:pin', sessionId, pinned),
  historyDelete: (sessionId: string) => ipcRenderer.invoke('history:delete', sessionId),

  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: (partial: Record<string, any>) => ipcRenderer.invoke('settings:save', partial),

  openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath),

  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsBuiltins: () => ipcRenderer.invoke('skills:builtins'),
  skillsSave: (skill: Record<string, any>, oldName?: string) => ipcRenderer.invoke('skills:save', skill, oldName),
  skillsDelete: (name: string) => ipcRenderer.invoke('skills:delete', name),
  skillsImport: () => ipcRenderer.invoke('skills:import'),
  skillsGenerate: (description: string) => ipcRenderer.invoke('skills:generate', description),
  skillsGenerateInstructions: (description: string, name?: string) =>
    ipcRenderer.invoke('skills:generateInstructions', description, name),
});
