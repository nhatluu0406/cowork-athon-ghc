import { Message, Provider, StreamEvent, CancelFn, ToolSpec, contentText } from './types';
import { UPDATE_PLAN_SPEC, normalizePlanSteps } from './plan';
import { SAVE_FILE_SPEC, doSaveFile, titledFilename } from './save-file-tool';
import { DOC_TOOL_SPECS, DOC_TOOL_NAMES, executeDocTool } from './doc-tools';
import { activeSkillsMessage, ACTIVE_SKILLS_TAG } from './skills-builtin';
import { activeSkillsText } from '../skills/store';
import { PdfRenderer } from '../docgen/html-pdf';

export type EmitFn = (event: StreamEvent) => void;

export const COWORK_SYSTEM_PROMPT =
  "You are Cowork Local — a friendly internal assistant. Answer concisely and " +
  "accurately in the user's language. When unsure, say so.";

export const COWORK_TOOL_PROMPT =
  COWORK_SYSTEM_PROMPT +
  '\nYou can create real files for the user in the output folder.\n' +
  '• For text (.md/.txt/.csv/.json/.html): call save_file(filename, content) ONCE with the FINAL ' +
  'content. Re-saving the same filename overwrites in place.\n' +
  '• For a Word document: call create_docx(filename, markdown) with the FULL content as Markdown.\n' +
  '• For a spreadsheet: call create_xlsx(filename, sheets) — sheets is [{name, rows}] with rows a 2D ' +
  'array whose first row is the header.\n' +
  '• For a presentation: call create_pptx(filename, slides) — slides is [{title, bullets, notes?}].\n' +
  '• For a PDF: call create_pdf(filename, html) with ONE complete self-contained HTML document ' +
  '(all CSS inline, A4-friendly).\n' +
  'If a tool call fails, read the error, fix the input, and call it again until the file is produced; ' +
  'then report the final file name. For plain conversation, do NOT call any tool.\n' +
  'For any task that takes more than one step, FIRST call update_plan with a short checklist ' +
  "(2–6 short imperative steps, each status 'pending'); then, as you work, call update_plan " +
  "again to mark the current step 'running' and finished steps 'done'. Skip the plan for a " +
  'trivial one-line reply.\n' +
  'Do NOT ask the user clarifying or confirmation questions — make reasonable assumptions and ' +
  'carry out the ORIGINAL request end-to-end on your own, then report only the final result.';

export interface RunCoworkOptions {
  cancel?: CancelFn;
  maxSteps?: number;
  title?: string;
  pdfRenderer?: PdfRenderer;
  /** Combined active-skills block; defaults to activeSkillsText(). Injected fresh every call. */
  skillsText?: string;
}

export async function runCowork(
  provider: Provider,
  messages: Message[],
  outputDir: string,
  emit: EmitFn,
  opts: RunCoworkOptions = {},
): Promise<Message[]> {
  const cancel = opts.cancel || (() => false);
  const maxSteps = opts.maxSteps ?? 30;
  const title = opts.title || '';

  if (!messages.length || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: COWORK_TOOL_PROMPT });
  }
  // Port of _apply_skills: drop any previous skills message, then insert the
  // current one — so enable/disable changes take effect on the very next turn.
  const skillsText = opts.skillsText ?? activeSkillsText();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(ACTIVE_SKILLS_TAG)) {
      messages.splice(i, 1);
    }
  }
  if (skillsText.trim()) {
    const at = messages.length && messages[0].role === 'system' ? 1 : 0;
    messages.splice(at, 0, { role: 'system', content: activeSkillsMessage(skillsText) });
  }

  const toolSpecs: ToolSpec[] = [SAVE_FILE_SPEC, UPDATE_PLAN_SPEC, ...DOC_TOOL_SPECS];

  for (let step = 0; step < maxSteps; step++) {
    if (cancel()) break;

    const onText = (piece: string) => emit({ type: 'text', delta: piece });
    const onReasoning = (piece: string) => emit({ type: 'reasoning', delta: piece });

    const assistant = await provider.chat(messages, toolSpecs, { onText, onReasoning, cancel });
    messages.push(assistant);

    const toolCalls = assistant.tool_calls || [];
    if (!toolCalls.length && !contentText(assistant.content).trim()) {
      emit({ type: 'text', delta: '*(model returned only its reasoning — try rephrasing)*' });
    }
    emit({ type: 'assistant_done', content: contentText(assistant.content) });

    if (!toolCalls.length) break;

    for (const tc of toolCalls) {
      if (cancel()) break;
      const { id: tcId, name, arguments: args } = tc;

      if (name === 'update_plan') {
        emit({ type: 'plan_set', steps: normalizePlanSteps((args as any).steps) });
        messages.push({ role: 'tool', tool_call_id: tcId, name, content: 'Plan updated.' });
        continue;
      }

      if (name === 'save_file') {
        const previewFilename = titledFilename(title, String((args as any).filename || 'output.txt'));
        emit({
          type: 'tool_proposed',
          id: tcId,
          name,
          args,
          preview: { kind: 'diff', title: `Save ${previewFilename}`, text: String((args as any).content || '').slice(0, 4000) },
        });
        const result = doSaveFile(outputDir, title, args as any);
        emit({
          type: 'tool_result',
          id: tcId,
          name,
          ok: result.ok,
          output: result.output,
          ...(result.path ? { path: result.path } : {}),
        });
        if (result.ok && result.path) {
          emit({ type: 'outputs_added', paths: [result.path] });
        }
        messages.push({ role: 'tool', tool_call_id: tcId, name, content: result.output });
        continue;
      }

      if (DOC_TOOL_NAMES.has(name)) {
        const previewFilename = titledFilename(title, String((args as any).filename || 'output'));
        const previewText = String(
          (args as any).markdown ?? (args as any).html ?? JSON.stringify((args as any).sheets ?? (args as any).slides ?? args, null, 2),
        ).slice(0, 4000);
        emit({
          type: 'tool_proposed',
          id: tcId,
          name,
          args,
          preview: { kind: 'diff', title: `Create ${previewFilename}`, text: previewText },
        });
        const result = await executeDocTool(outputDir, title, name, args as any, opts.pdfRenderer);
        emit({
          type: 'tool_result',
          id: tcId,
          name,
          ok: result.ok,
          output: result.output,
          ...(result.path ? { path: result.path } : {}),
        });
        if (result.ok && result.path) {
          emit({ type: 'outputs_added', paths: [result.path] });
        }
        messages.push({ role: 'tool', tool_call_id: tcId, name, content: result.output });
        continue;
      }

      // Unknown tool — should not happen given the fixed toolSpecs above.
      messages.push({ role: 'tool', tool_call_id: tcId, name, content: `Tool not found: ${name}` });
    }
  }

  return messages;
}
