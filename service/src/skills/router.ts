/**
 * Token-guarded Skills API. Filesystem access and validation remain service-owned.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { SkillCreateDraft, SkillDraft } from "./types.js";
import type { SkillCatalog } from "./types.js";

export const SKILLS_PATH = "/v1/skills";
export const SKILLS_REFRESH_PATH = "/v1/skills/refresh";
export const SKILLS_ENABLED_PATH = "/v1/skills/enabled";
export const SKILL_ENABLED_PATH = "/v1/skills/{id}/enabled";
export const SKILL_PREVIEW_PATH = "/v1/skills/{id}/preview";
export const SKILL_CONTENT_PATH = "/v1/skills/{id}/content";

function requireId(ctx: RouteContext): string {
  const id = ctx.params["id"];
  if (id === undefined || id.trim().length === 0) throw new BadRequestError("Skill id is required.");
  return id;
}

function parseDraft(body: unknown): SkillDraft {
  if (typeof body !== "object" || body === null) throw new BadRequestError("Body must be an object.");
  const record = body as Record<string, unknown>;
  const name = record["name"];
  const description = record["description"];
  const version = record["version"];
  const content = record["body"] ?? record["content"];
  if (typeof name !== "string") throw new BadRequestError("name is required.");
  if (typeof description !== "string") throw new BadRequestError("description is required.");
  if (typeof version !== "string") throw new BadRequestError("version is required.");
  if (typeof content !== "string") throw new BadRequestError("body is required.");
  return { name, description, version, body: content };
}

function parseCreateDraft(body: unknown): SkillCreateDraft {
  const draft = parseDraft(body);
  if (typeof body !== "object" || body === null) return draft;
  const id = (body as Record<string, unknown>)["id"];
  return typeof id === "string" && id.trim().length > 0 ? { ...draft, id: id.trim() } : draft;
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
        path: SKILLS_PATH,
        handler: async (ctx): Promise<RouteResult> => {
          try {
            return {
              status: 201,
              data: { skill: await catalog.createUserSkill(parseCreateDraft(ctx.body)) },
            };
          } catch (error) {
            throw new BadRequestError(error instanceof Error ? error.message : "Không thể tạo Skill.");
          }
        },
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
      {
        method: "GET",
        path: SKILL_CONTENT_PATH,
        handler: (ctx): RouteResult => ({
          status: 200,
          data: { content: catalog.readContent(requireId(ctx)) },
        }),
      },
      {
        method: "PUT",
        path: "/v1/skills/{id}",
        handler: async (ctx): Promise<RouteResult> => {
          try {
            return {
              status: 200,
              data: { skill: await catalog.updateUserSkill(requireId(ctx), parseDraft(ctx.body)) },
            };
          } catch (error) {
            throw new BadRequestError(error instanceof Error ? error.message : "Không thể cập nhật Skill.");
          }
        },
      },
      {
        method: "DELETE",
        path: "/v1/skills/{id}",
        handler: async (ctx): Promise<RouteResult> => {
          try {
            await catalog.deleteUserSkill(requireId(ctx));
            return { status: 200, data: { ok: true } };
          } catch (error) {
            throw new BadRequestError(error instanceof Error ? error.message : "Không thể xóa Skill.");
          }
        },
      },
    ],
  };
}
