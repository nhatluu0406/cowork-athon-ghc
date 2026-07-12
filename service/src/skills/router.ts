/**
 * Token-guarded Skills API. Filesystem access and validation remain service-owned.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { SkillCatalog } from "./types.js";

export const SKILLS_PATH = "/v1/skills";
export const SKILLS_REFRESH_PATH = "/v1/skills/refresh";
export const SKILLS_ENABLED_PATH = "/v1/skills/enabled";
export const SKILL_ENABLED_PATH = "/v1/skills/{id}/enabled";
export const SKILL_PREVIEW_PATH = "/v1/skills/{id}/preview";

function requireId(ctx: RouteContext): string {
  const id = ctx.params["id"];
  if (id === undefined || id.trim().length === 0) throw new BadRequestError("Skill id is required.");
  return id;
}

export function createSkillRouter(catalog: SkillCatalog): BoundaryRouter {
  return {
    name: "skills",
    routes: [
      {
        method: "GET",
        path: SKILLS_PATH,
        handler: (): RouteResult => ({ status: 200, data: { skills: catalog.list() } }),
      },
      {
        method: "POST",
        path: SKILLS_REFRESH_PATH,
        handler: async (): Promise<RouteResult> => ({
          status: 200,
          data: { skills: await catalog.refresh() },
        }),
      },
      {
        method: "GET",
        path: SKILLS_ENABLED_PATH,
        handler: (): RouteResult => ({
          status: 200,
          data: { skills: catalog.enabledSnapshots() },
        }),
      },
      {
        method: "PUT",
        path: SKILL_ENABLED_PATH,
        handler: async (ctx): Promise<RouteResult> => {
          if (typeof ctx.body !== "object" || ctx.body === null) {
            throw new BadRequestError("Body must be an object.");
          }
          const enabled = (ctx.body as Record<string, unknown>)["enabled"];
          if (typeof enabled !== "boolean") throw new BadRequestError("enabled must be boolean.");
          return {
            status: 200,
            data: { skill: await catalog.setEnabled(requireId(ctx), enabled) },
          };
        },
      },
      {
        method: "GET",
        path: SKILL_PREVIEW_PATH,
        handler: (ctx): RouteResult => ({
          status: 200,
          data: { preview: catalog.preview(requireId(ctx)) },
        }),
      },
    ],
  };
}
