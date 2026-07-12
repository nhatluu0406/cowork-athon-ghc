/**
 * Browser-safe client of the loopback service (ADR 0003).
 *
 * The renderer is an HTTP client of the local application service, exactly like the
 * shell and the integration tests. It reaches the service ONLY through this typed client
 * — never a generic passthrough, never direct filesystem/credential access. This mirrors
 * the authoritative contract in `service/src/boundary/{client,contract}.ts`: a Bearer
 * per-launch token on every request and a versioned `{ ok, data | error }` envelope.
 *
 * It is deliberately a small, dependency-free fetch wrapper so the renderer bundle never
 * pulls the Node-only `@cowork-ghc/service` package. Later UI tasks widen it with more
 * typed methods, each mapping to a declared boundary route. The token is held in a
 * closure only — never placed in the DOM, `localStorage`, or logs.
 */
import { BOUNDARY_PROTOCOL_VERSION, } from "@cowork-ghc/contracts";
import { createPermissionClient, } from "./permission-client.js";
/** Error surfaced by the client; carries a stable, non-secret code. */
export class ServiceClientError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ServiceClientError";
    }
}
/** Create a client bound to a loopback base URL + per-launch token. */
export function createServiceClient(baseUrl, clientToken) {
    const root = baseUrl.replace(/\/$/, "");
    async function call(path, init) {
        const headers = { authorization: `Bearer ${clientToken}` };
        if (init?.body !== undefined)
            headers["content-type"] = "application/json";
        const response = await fetch(`${root}${path}`, { ...init, headers });
        const envelope = (await response.json());
        // Refuse a wrong/drifted wire contract rather than silently accepting it: the service
        // stamps every envelope with the shared protocol tag (single source of truth in
        // `@cowork-ghc/contracts`). A mismatch means the two ends disagree on the wire shape.
        if (envelope.protocol !== BOUNDARY_PROTOCOL_VERSION) {
            throw new ServiceClientError("protocol_mismatch", `Unexpected boundary protocol (expected ${BOUNDARY_PROTOCOL_VERSION}).`);
        }
        if (!envelope.ok) {
            throw new ServiceClientError(envelope.error.code, envelope.error.message);
        }
        return envelope.data;
    }
    const permission = createPermissionClient(call);
    return {
        health: () => call("/v1/health"),
        grantWorkspace: (rootPath) => call("/v1/workspace/grant", {
            method: "POST",
            body: JSON.stringify({ rootPath }),
        }),
        recentWorkspaces: async () => (await call("/v1/workspace/recent")).recent,
        getSettings: async () => (await call("/v1/settings")).settings,
        listProviders: async () => (await call("/v1/providers")).providers,
        storeProviderCredential: async (providerId, secret) => {
            const { ref } = await call("/v1/credentials", {
                method: "POST",
                body: JSON.stringify({ providerId, secret }),
            });
            return (await call("/v1/settings/providers/credential", {
                method: "PUT",
                body: JSON.stringify({ providerId, ref }),
            })).settings;
        },
        importProviderCredentialFromEnv: async (providerId, envVar) => {
            const { ref } = await call("/v1/credentials/import-env", {
                method: "POST",
                body: JSON.stringify({ providerId, envVar }),
            });
            return (await call("/v1/settings/providers/credential", {
                method: "PUT",
                body: JSON.stringify({ providerId, ref }),
            })).settings;
        },
        removeProviderCredential: async (providerId) => {
            const settings = (await call("/v1/settings")).settings;
            const row = settings.providers.find((p) => p.providerId === providerId);
            if (row?.hasCredential && row.credentialAccount !== undefined) {
                await call("/v1/credentials", {
                    method: "DELETE",
                    body: JSON.stringify({ ref: { store: "os", account: row.credentialAccount } }),
                });
            }
            return (await call("/v1/settings/providers/credential", {
                method: "DELETE",
                body: JSON.stringify({ providerId }),
            })).settings;
        },
        setProviderEnvVar: async (providerId, envVar) => (await call("/v1/settings/providers/env-var", {
            method: "PUT",
            body: JSON.stringify({ providerId, envVar }),
        })).settings,
        testProviderConnection: async (providerId) => (await call("/v1/providers/test-connection", {
            method: "POST",
            body: JSON.stringify({ providerId }),
        })).result,
        updateGeneral: async (patch) => (await call("/v1/settings/general", {
            method: "PATCH",
            body: JSON.stringify(patch),
        })).settings,
        setProviderCredentialRef: async (providerId, ref) => (await call("/v1/settings/providers/credential", {
            method: "PUT",
            body: JSON.stringify({ providerId, ref }),
        })).settings,
        removeProviderCredentialRef: async (providerId) => (await call("/v1/settings/providers/credential", {
            method: "DELETE",
            body: JSON.stringify({ providerId }),
        })).settings,
        setProviderBaseUrl: async (providerId, baseUrl) => (await call("/v1/settings/providers/base-url", {
            method: "PUT",
            body: JSON.stringify({ providerId, baseUrl }),
        })).settings,
        setDefaultModel: async (model) => (await call("/v1/settings/model/default", {
            method: "PUT",
            body: JSON.stringify({ model }),
        })).settings,
        setActiveWorkspace: async (rootPath) => (await call("/v1/settings/active-workspace", {
            method: "PUT",
            body: JSON.stringify({ rootPath }),
        })).settings,
        clearSessionModel: (sessionId) => call("/v1/settings/model/session", {
            method: "DELETE",
            body: JSON.stringify({ sessionId }),
        }),
        createSession: async (input) => (await call("/v1/session", {
            method: "POST",
            body: JSON.stringify(input),
        })).session,
        sendSessionMessage: async (sessionId, text) => {
            const data = await call(`/v1/session/${encodeURIComponent(sessionId)}/message`, {
                method: "POST",
                body: JSON.stringify({ text }),
            });
            if (data.accepted)
                return { accepted: true, sessionId: data.sessionId };
            return {
                accepted: false,
                sessionId: data.sessionId,
                reason: data.reason ?? data.code ?? "runtime_unavailable",
            };
        },
        cancelSession: async (sessionId) => {
            await call(`/v1/session/${encodeURIComponent(sessionId)}/cancel`, { method: "POST", body: "{}" });
        },
        listConversations: async (query) => {
            const q = query?.trim();
            const path = q !== undefined && q.length > 0
                ? `/v1/conversations?q=${encodeURIComponent(q)}`
                : "/v1/conversations";
            return (await call(path)).conversations;
        },
        createConversation: async (input) => (await call("/v1/conversations", {
            method: "POST",
            body: JSON.stringify(input),
        })).conversation,
        getConversation: async (id) => (await call(`/v1/conversations/${encodeURIComponent(id)}`)).conversation,
        patchConversation: async (id, patch) => (await call(`/v1/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })).conversation,
        deleteConversation: async (id) => {
            await call(`/v1/conversations/${encodeURIComponent(id)}`, {
                method: "DELETE",
            });
        },
        appendConversationMessage: async (id, role, text) => (await call(`/v1/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ role, text }) })).conversation,
        continueRuntimeSession: async (sessionId) => call(`/v1/session/${encodeURIComponent(sessionId)}/continue`, { method: "POST", body: "{}" }),
        listPendingPermissions: permission.listPendingPermissions,
        decidePermission: permission.decidePermission,
    };
}
//# sourceMappingURL=service-client.js.map