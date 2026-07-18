/**
 * Modal dialog for adding or editing a Power Automate flow. Mirrors permission-modal.ts:
 * backdrop + role="dialog" with a focus trap and focus restore. It closes on Escape or the Hủy
 * button, but NOT on a backdrop click — the form holds unsaved input, so an accidental outside
 * click must not discard it. The flow URL is a bearer secret — in edit mode the URL field is
 * NEVER pre-filled; blank means "keep the stored URL". The name is the identity key, so it is
 * read-only in edit mode. payloadSchema is a JSON Schema text validated as parseable JSON (empty
 * allowed) live while typing AND again before submit.
 */
import { el } from "../dom-utils.js";

export interface FlowDialogValues { name: string; url: string; description: string; payloadSchema: string; timeoutSec: number }
export interface FlowDialogOptions {
  mode: "add" | "edit";
  initial?: { name: string; description: string; payloadSchema: string; timeoutSec: number };
  onSubmit: (values: FlowDialogValues) => Promise<void>;
}

const FOCUSABLE = 'button, input, textarea, [tabindex]:not([tabindex="-1"])';

export function openFlowDialog(container: HTMLElement, opts: FlowDialogOptions): void {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const backdrop = el("div", "ms-flow-dialog-backdrop");
  const dialog = el("section", "ms-flow-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const title = el("h2", "ms-flow-dialog__title", opts.mode === "add" ? "Thêm Power Automate flow" : "Sửa flow");

  const nameInput = el("input", "ms-flow-dialog__name") as HTMLInputElement;
  nameInput.type = "text";
  nameInput.placeholder = "Tên flow";
  nameInput.autocomplete = "off";
  if (opts.mode === "edit" && opts.initial) { nameInput.value = opts.initial.name; nameInput.readOnly = true; }

  const urlInput = el("input", "ms-flow-dialog__url") as HTMLInputElement;
  urlInput.type = "text";
  urlInput.autocomplete = "off";
  urlInput.spellcheck = false;
  urlInput.placeholder = opts.mode === "edit" ? "Để trống nếu giữ URL cũ" : "URL HTTP-trigger của flow";

  const descInput = el("textarea", "ms-flow-dialog__desc") as HTMLTextAreaElement;
  descInput.rows = 2;
  descInput.placeholder = "Mô tả (cho Agent): flow làm gì, khi nào dùng";
  if (opts.initial) descInput.value = opts.initial.description;

  const schemaInput = el("textarea", "ms-flow-dialog__schema") as HTMLTextAreaElement;
  schemaInput.rows = 4;
  schemaInput.spellcheck = false;
  schemaInput.placeholder = 'Payload JSON Schema (tùy chọn), ví dụ {"type":"object","properties":{"message":{"type":"string"}}}';
  if (opts.initial) schemaInput.value = opts.initial.payloadSchema;

  // Live JSON validity feedback for the schema field: shown while typing, not only on submit.
  const schemaError = el("p", "ms-flow-dialog__schema-error", "");
  schemaError.setAttribute("role", "alert");
  schemaError.setAttribute("aria-live", "polite");
  schemaError.hidden = true;
  const validateSchemaLive = (): void => {
    const v = schemaInput.value.trim();
    if (v.length === 0) { schemaError.hidden = true; return; }
    try { JSON.parse(v); schemaError.hidden = true; }
    catch { schemaError.textContent = "JSON Schema không hợp lệ (chưa đúng cú pháp JSON)."; schemaError.hidden = false; }
  };
  schemaInput.addEventListener("input", validateSchemaLive);
  if (opts.initial) validateSchemaLive();

  const timeoutInput = el("input", "ms-flow-dialog__timeout") as HTMLInputElement;
  timeoutInput.type = "number";
  timeoutInput.min = "1";
  timeoutInput.placeholder = "Timeout (giây)";
  timeoutInput.value = String(opts.initial?.timeoutSec ?? 120);

  const errorSlot = el("p", "ms-flow-dialog__error", "");
  errorSlot.setAttribute("role", "alert");
  errorSlot.setAttribute("aria-live", "assertive");
  errorSlot.hidden = true;

  const cancelBtn = el("button", "ms-flow-dialog__cancel", "Hủy") as HTMLButtonElement;
  cancelBtn.type = "button";
  const saveBtn = el("button", "ms-flow-dialog__save", "Lưu") as HTMLButtonElement;
  saveBtn.type = "button";
  const actions = el("footer", "ms-flow-dialog__actions");
  actions.append(cancelBtn, saveBtn);

  dialog.append(title, labeled("Tên", nameInput), labeled("URL", urlInput), labeled("Mô tả", descInput), labeled("Payload JSON Schema", schemaInput), schemaError, labeled("Timeout (giây)", timeoutInput), errorSlot, actions);
  backdrop.append(dialog);
  container.append(backdrop);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") previouslyFocused.focus();
  };

  const showError = (msg: string): void => { errorSlot.textContent = msg; errorSlot.hidden = false; };

  const submit = (): void => {
    if (closed) return;
    const name = opts.mode === "edit" && opts.initial ? opts.initial.name : nameInput.value.trim();
    const url = urlInput.value.trim();
    const description = descInput.value;
    const payloadSchema = schemaInput.value.trim();
    const secs = Number.parseInt(timeoutInput.value, 10);
    if (name.length === 0) return showError("Cần nhập tên flow.");
    if (opts.mode === "add" && url.length === 0) return showError("Cần nhập URL flow.");
    if (!Number.isFinite(secs) || secs < 1) return showError("Timeout phải là số giây ≥ 1.");
    if (payloadSchema.length > 0) { try { JSON.parse(payloadSchema); } catch { return showError("Payload JSON Schema không phải JSON hợp lệ."); } }
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    errorSlot.hidden = true;
    void opts.onSubmit({ name, url, description, payloadSchema, timeoutSec: secs })
      .then(() => close())
      .catch(() => { showError("Không lưu được flow (trùng tên hoặc lỗi). Thử lại."); saveBtn.disabled = false; cancelBtn.disabled = false; });
  };

  function onKeydown(event: KeyboardEvent): void {
    if (closed) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  cancelBtn.addEventListener("click", close);
  saveBtn.addEventListener("click", submit);
  // Intentionally NO backdrop-click-to-close: the form holds unsaved input; an accidental
  // outside click must not discard it. Close via Escape or the Hủy button only.
  document.addEventListener("keydown", onKeydown, true);
  (opts.mode === "edit" ? descInput : nameInput).focus();
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", "ms-flow-dialog__field");
  wrap.append(el("span", "ms-flow-dialog__field-label", label), control);
  return wrap;
}
