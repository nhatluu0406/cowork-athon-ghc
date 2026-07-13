/**
 * File-action truthfulness helpers.
 *
 * A model response is not evidence that a workspace mutation happened. These helpers keep
 * the user-facing result honest by detecting an explicit file-action request and requiring
 * a verified File Work Review artifact for the same runtime turn before Cowork presents the
 * action as verified.
 */
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
export type FileActionIntent = "create" | "edit" | "delete" | "move";
/** Detect only explicit file-mutation requests; normal chat is intentionally ignored. */
export declare function detectFileActionIntent(text: string): FileActionIntent | null;
/** True only when this runtime turn has a disk-backed review matching the requested action. */
export declare function hasVerifiedFileAction(reviews: readonly FileReviewArtifact[], runtimeTurnId: string, intent: FileActionIntent): boolean;
export declare const UNVERIFIED_FILE_ACTION_WARNING = "Cowork GHC ch\u01B0a x\u00E1c minh \u0111\u01B0\u1EE3c thay \u0111\u1ED5i t\u1EC7p. Kh\u00F4ng c\u00F3 b\u1EB1ng ch\u1EE9ng th\u1EF1c thi v\u00E0 tr\u1EA1ng th\u00E1i t\u1EC7p ph\u00F9 h\u1EE3p, n\u00EAn y\u00EAu c\u1EA7u n\u00E0y \u0111\u01B0\u1EE3c xem l\u00E0 ch\u01B0a ho\u00E0n t\u1EA5t.";
/** Preserve the model text as context, but never present it as verified product truth. */
export declare function markFileActionUnverified(text: string): string;
//# sourceMappingURL=file-action-integrity.d.ts.map