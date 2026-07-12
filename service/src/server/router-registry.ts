/**
 * Route registry — the mount seam for the boundary (design §9).
 *
 * Downstream tasks (workspace, session, permission, files, provider, credential,
 * diagnostics, execution) each expose a {@link BoundaryRouter} and mount it here.
 * The registry rejects duplicate `method + path` registrations, and whenever a route
 * opts out of the token guard (`publicUnauthenticated: true`) it records the fact and
 * emits a {@link BoundaryAuditEvent} so an unauthenticated route is always visible in
 * review — closing the latent token-bypass on the opt-out.
 *
 * Routing is EXACT-path-first: a literal `method + path` match always wins. A declared
 * path may also carry `{name}` segments (e.g. `/v1/session/{id}/message`); such patterns
 * are tried only after every exact route misses, and the captured segment values are
 * returned as {@link RouteMatch.params} (populating the reserved `RouteContext.params`).
 * The `{...}`-bearing literal is still what dedupe/audit key on, so two routers declaring
 * the same pattern still collide.
 */

import type {
  AnyRouteDefinition,
  BoundaryAuditEvent,
  BoundaryAuditSink,
  BoundaryRouter,
} from "../boundary/contract.js";

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Safely percent-decode one path segment. A client-malformed escape (`%`, `%zz`, a lone
 * surrogate) makes {@link decodeURIComponent} throw `URIError`; returning `null` here lets the
 * caller treat it as a SEGMENT MISMATCH (→ no route matches → 404) instead of letting the
 * error bubble into a generic 500 (FIX-2). Bad client input is a 4xx, never a server error.
 */
function safeDecodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Match pre-split pattern segments against pre-split request segments (equal length assumed).
 * A `{name}` segment captures the (non-empty, URI-decoded) request segment; a literal segment
 * must equal the request segment. Returns the captured params, or `null` on any mismatch —
 * including a malformed percent-encoding in a captured segment (safe-decode → mismatch).
 */
function matchSegments(
  pattern: readonly string[],
  request: readonly string[],
): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const seg = pattern[i] as string;
    const raw = request[i] as string;
    if (seg.startsWith("{") && seg.endsWith("}")) {
      if (raw.length === 0) return null;
      const decoded = safeDecodeSegment(raw);
      if (decoded === null) return null;
      params[seg.slice(1, -1)] = decoded;
    } else if (seg !== raw) {
      return null;
    }
  }
  return params;
}

export class DuplicateRouteError extends Error {
  readonly code = "duplicate_route";
  constructor(key: string, existingRouter: string, incomingRouter: string) {
    super(
      `Route "${key}" from router "${incomingRouter}" collides with router ` +
        `"${existingRouter}"; each method+path may be mounted once.`,
    );
    this.name = "DuplicateRouteError";
  }
}

interface RegisteredRoute {
  readonly definition: AnyRouteDefinition;
  readonly router: string;
}

/** A route matched against a request path, plus any captured `{name}` path params. */
export interface RouteMatch {
  readonly definition: AnyRouteDefinition;
  readonly params: Readonly<Record<string, string>>;
}

/** A compiled `{name}`-bearing pattern route, tried only after exact routes miss. */
interface PatternRoute {
  readonly method: string;
  readonly segments: readonly string[];
  readonly definition: AnyRouteDefinition;
}

const EMPTY_PARAMS: Readonly<Record<string, string>> = Object.freeze({});

export class RouterRegistry {
  private readonly routes = new Map<string, RegisteredRoute>();
  private readonly patterns: PatternRoute[] = [];
  private readonly unauthenticated: BoundaryAuditEvent[] = [];

  constructor(private readonly audit?: BoundaryAuditSink) {}

  /** Mount every route of `router`, failing closed on any duplicate; audit public routes. */
  mount(router: BoundaryRouter): void {
    for (const definition of router.routes) {
      const key = routeKey(definition.method, definition.path);
      const existing = this.routes.get(key);
      if (existing) throw new DuplicateRouteError(key, existing.router, router.name);
      this.routes.set(key, { definition, router: router.name });
      if (definition.path.includes("{")) {
        this.patterns.push({
          method: definition.method.toUpperCase(),
          segments: definition.path.split("/"),
          definition,
        });
      }
      if (definition.publicUnauthenticated === true) {
        const event: BoundaryAuditEvent = {
          type: "unauthenticated_route_mounted",
          method: definition.method,
          path: definition.path,
          router: router.name,
        };
        this.unauthenticated.push(event);
        this.audit?.(event);
      }
    }
  }

  /** Look up a route by method + exact path (no pattern matching). */
  find(method: string, path: string): AnyRouteDefinition | undefined {
    return this.routes.get(routeKey(method, path))?.definition;
  }

  /**
   * Resolve a request to a route: an EXACT `method + path` hit first (params empty), else the
   * first `{name}`-pattern route of the same method whose segments match, with captured params.
   * Returns `undefined` when nothing matches.
   */
  match(method: string, path: string): RouteMatch | undefined {
    const exact = this.routes.get(routeKey(method, path));
    if (exact) return { definition: exact.definition, params: EMPTY_PARAMS };
    const upper = method.toUpperCase();
    const reqSegments = path.split("/");
    for (const pattern of this.patterns) {
      if (pattern.method !== upper || pattern.segments.length !== reqSegments.length) continue;
      const params = matchSegments(pattern.segments, reqSegments);
      if (params !== null) return { definition: pattern.definition, params };
    }
    return undefined;
  }

  /** Recorded unauthenticated-route mounts (for review/tests). */
  get unauthenticatedRoutes(): readonly BoundaryAuditEvent[] {
    return this.unauthenticated;
  }

  /** Number of mounted routes (diagnostics/tests). */
  get size(): number {
    return this.routes.size;
  }
}
