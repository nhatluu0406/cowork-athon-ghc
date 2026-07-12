/**
 * Transport-only instruction envelope for service-validated, user-enabled local Skills.
 */
import type { EnabledSkillSnapshot, SkillUseMetadata } from "./service-client.js";
export declare const SKILL_ENVELOPE_START = "<<<CGHC_SELECTED_LOCAL_SKILLS>>>";
export declare const SKILL_ENVELOPE_END = "<<<END_CGHC_SELECTED_LOCAL_SKILLS>>>";
export interface SkillContextAssembly {
    readonly text: string;
    readonly metadata: readonly SkillUseMetadata[];
    readonly charCount: number;
}
export declare function assembleSkillContext(skills: readonly EnabledSkillSnapshot[]): SkillContextAssembly;
//# sourceMappingURL=skill-context.d.ts.map