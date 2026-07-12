/**
 * Local instruction-only Skills exposed by the application service.
 *
 * A Skill is text context, never executable code or a new capability boundary.
 */

export type SkillSource = "built_in" | "user_local";
export type SkillStatus = "enabled" | "disabled" | "invalid";

export interface SkillView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly source: SkillSource;
  readonly status: SkillStatus;
  readonly validationStatus: "valid" | "invalid";
  readonly invalidReason?: string;
  readonly contentHash?: string;
  readonly modifiedAt?: string;
  readonly sizeBytes?: number;
}

/** Immutable provenance attached to the user message for one dispatched turn. */
export interface SkillUseMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly source: SkillSource;
  readonly contentHash: string;
  readonly modifiedAt: string;
}

/** Service-validated instruction content used only while planning outbound transport. */
export interface EnabledSkillSnapshot {
  readonly metadata: SkillUseMetadata;
  readonly content: string;
}

export interface SkillCatalog {
  refresh(): Promise<readonly SkillView[]>;
  list(): readonly SkillView[];
  setEnabled(id: string, enabled: boolean): Promise<SkillView>;
  enabledSnapshots(): readonly EnabledSkillSnapshot[];
  preview(id: string): { readonly content: string; readonly truncated: boolean };
}

export interface SkillRoot {
  readonly path: string;
  readonly source: SkillSource;
  /** User-local roots are created on first discovery; built-ins remain read-only. */
  readonly createIfMissing?: boolean;
}
