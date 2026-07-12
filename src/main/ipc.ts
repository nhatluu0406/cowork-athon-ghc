import { ipcMain, shell, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import { AppConfig, AppConfigData, CONFIG_PATH } from './config';
import { createProvider } from './agent/provider-factory';
import { runCowork } from './agent/run-cowork';
import { ConversationManager } from './conversation-manager';
import {
  newSessionId,
  saveConversation,
  loadConversation,
  listConversations,
  deleteConversation,
  renameConversation,
  setPinned,
} from './history-store';
import { ContentPart, Message } from './agent/types';
import { compressHistory } from './history-compress';
import { augmentPrompt } from './attachments/augment-prompt';
import { savePastedImage } from './attachments/pasted-image';
import { parseSkillCommand } from './skills/parse-command';
import {
  Skill,
  listSkills,
  saveSkill,
  deleteSkill,
  importSkillFile,
  pruneSeededBuiltins,
} from './skills/store';
import { generateSkill, generateSkillInstructions } from './skills/generate';
import { BUILTIN_SKILLS } from './agent/skills-builtin';

const config = AppConfig.load(CONFIG_PATH);

const conversationHistories = new Map<string, Message[]>();
const conversationTitles = new Map<string, string>();

function getHistory(conversationId: string): Message[] {
  return conversationHistories.get(conversationId) || [];
}

// ConversationManager.start() builds its own `messages` array as
// `[...pending.getHistory(), pending.userMessage]` and passes it to runTurn below.
// runTurn has no conversationId parameter, so we identify which conversation a given
// turn belongs to by the identity of the `userMessage` object it contains (the exact
// object we created in the cowork:send handler and handed to manager.send).
const turnConversation = new WeakMap<Message, string>();

const manager = new ConversationManager({
  maxParallel: config.data.cowork.max_parallel,
  runTurn: async (messages, emit, cancel) => {
    const userMessage = messages[messages.length - 1];
    const conversationId = turnConversation.get(userMessage);
    let updated: Message[];
    try {
      updated = await runCowork(createProvider(config), messages, config.coworkOutputDir(), emit, { cancel });
    } catch (err) {
      // Surface the failure to the renderer before it disappears into
      // ConversationManager's bookkeeping-only `.catch(() => undefined)`.
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      turnConversation.delete(userMessage);
      throw err;
    }
    // runCowork mutates `messages` in place and returns the same array; this is the ONE
    // point per user turn — after the whole multi-step agent loop has finished — where
    // the finished conversation state is committed to memory and persisted to disk.
    if (conversationId) {
      conversationHistories.set(conversationId, updated);
      persistConversation(conversationId);
    }
    turnConversation.delete(userMessage);
    return updated;
  },
});

// Port of chat_panel.py:559 — prepend the /skill prefix to the (possibly
// attachment-augmented) request content with the original "---" separator.
function prependSkillPrefix(prefix: string, content: string | ContentPart[]): string | ContentPart[] {
  if (!prefix) return content;
  const sep = '\n\n---\n\n';
  if (typeof content === 'string') return prefix + sep + content;
  const [first, ...restParts] = content;
  if (first && first.type === 'text') {
    return [{ type: 'text', text: prefix + sep + first.text }, ...restParts];
  }
  return [{ type: 'text', text: prefix }, ...content];
}

export function registerIpcHandlers(mainWin: BrowserWindow): void {
  pruneSeededBuiltins();

  ipcMain.handle('cowork:send', async (_e, conversationId: string, text: string, attachmentPaths: string[] = []) => {
    const { prefix, request, info } = parseSkillCommand(text);
    if (info !== null) {
      // Local /skill command (list / select / error) — answered inline, no agent turn.
      return { info };
    }
    const limits = {
      maxFiles: config.data.attachments.max_files,
      maxTokens: config.data.attachments.max_tokens,
    };
    const augmented = await augmentPrompt(request, attachmentPaths, limits);
    const content = prependSkillPrefix(prefix, augmented);
    const userMessage: Message = { role: 'user', content };
    if (prefix || attachmentPaths.length) {
      userMessage.display = request;
    }
    if (attachmentPaths.length) {
      userMessage.attachments = [...attachmentPaths];
    }
    turnConversation.set(userMessage, conversationId);
    const result = manager.send(conversationId, userMessage, () => getHistory(conversationId), (messageId, event) => {
      mainWin.webContents.send('cowork:event', messageId, event);
    });
    return result;
  });

  ipcMain.handle('cowork:cancel', (_e, conversationId: string, messageId: string) => manager.cancel(conversationId, messageId));

  ipcMain.handle('cowork:compress', (_e, conversationId: string) => {
    const current = getHistory(conversationId);
    const { messages: compressed, removed } = compressHistory(current);
    if (removed > 0) {
      conversationHistories.set(conversationId, compressed);
      persistConversation(conversationId);
    }
    return { removed };
  });

  ipcMain.handle('attachment:pick', async () => {
    const result = await dialog.showOpenDialog(mainWin, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Files', extensions: ['*'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('attachment:savePastedImage', (_e, base64Png: string) => savePastedImage(base64Png));

  ipcMain.handle('history:list', () => listConversations(config.historyDir()).filter((c) => c.kind === 'cowork' || c.kind === ''));

  ipcMain.handle('history:load', (_e, sessionId: string) => {
    const filePath = path.join(config.historyDir(), `cowork__${sessionId}.json`);
    const record = loadConversation(filePath);
    conversationHistories.set(sessionId, record.messages);
    conversationTitles.set(sessionId, record.title);
    return record;
  });

  ipcMain.handle('history:new', () => {
    const sessionId = newSessionId();
    conversationHistories.set(sessionId, []);
    return { sessionId };
  });

  ipcMain.handle('history:rename', (_e, sessionId: string, title: string) => {
    const filePath = path.join(config.historyDir(), `cowork__${sessionId}.json`);
    renameConversation(filePath, title);
  });

  ipcMain.handle('history:pin', (_e, sessionId: string, pinned: boolean) => {
    const filePath = path.join(config.historyDir(), `cowork__${sessionId}.json`);
    setPinned(filePath, pinned);
  });

  ipcMain.handle('history:delete', (_e, sessionId: string) => {
    const filePath = path.join(config.historyDir(), `cowork__${sessionId}.json`);
    deleteConversation(filePath);
    conversationHistories.delete(sessionId);
  });

  ipcMain.handle('settings:get', () => config.data);

  ipcMain.handle('settings:save', (_e, partial: Partial<AppConfigData>) => {
    config.mergeAndSave(partial);
  });

  ipcMain.handle('skills:list', () => listSkills());

  ipcMain.handle('skills:builtins', () => BUILTIN_SKILLS);

  ipcMain.handle('skills:save', (_e, skill: Skill, oldName?: string) => {
    saveSkill(skill, undefined, oldName || '');
  });

  ipcMain.handle('skills:delete', (_e, name: string) => {
    deleteSkill(name);
  });

  ipcMain.handle('skills:import', async () => {
    const result = await dialog.showOpenDialog(mainWin, {
      properties: ['openFile'],
      filters: [
        { name: 'Skills', extensions: ['skill', 'json', 'md', 'txt'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return { imported: null };
    try {
      return { imported: importSkillFile(result.filePaths[0]) };
    } catch (exc: any) {
      return { error: exc?.message || String(exc) };
    }
  });

  ipcMain.handle('skills:generate', async (_e, description: string) => {
    try {
      return { skill: await generateSkill(createProvider(config), description) };
    } catch (exc: any) {
      return { error: exc?.message || String(exc) };
    }
  });

  ipcMain.handle('skills:generateInstructions', (_e, description: string, name?: string) =>
    generateSkillInstructions(createProvider(config), description, name || ''),
  );

  ipcMain.handle('shell:openPath', (_e, targetPath: string) => {
    shell.showItemInFolder(targetPath);
  });

  ipcMain.on('win:minimize', () => mainWin.minimize());
  ipcMain.on('win:maximize', () => (mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize()));
  ipcMain.on('win:close', () => mainWin.close());
  ipcMain.on('open-external', (_e, url: string) => shell.openExternal(url));
}

function persistConversation(conversationId: string): void {
  const messages = getHistory(conversationId);
  const title = conversationTitles.get(conversationId);
  saveConversation(config.historyDir(), 'cowork', conversationId, messages, title ? { title } : {});
  if (config.data.last_session.cowork !== conversationId) {
    config.data.last_session.cowork = conversationId;
    config.save();
  }
}
