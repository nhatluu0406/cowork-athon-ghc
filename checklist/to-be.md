# Proposed Target Architecture: "To-Be" System

This document outlines the proposed target architecture and integration path for **D1 Dispatch backend integration**, aligning the local agent harness with the remote gateway capabilities.

---

## 1. Target Architecture Overview

The "To-Be" system establishes a unified bridge between local task execution and the remote/cloud dispatch gateway. It enables full integration of the **D1 Dispatch backend** to leverage local runtimes for parallel execution:

```mermaid
graph TD
    subgraph D1 Dispatch Cloud Backend
        Orch[D1 Cloud Orchestrator]
        Policies[Centralized Loop Policies]
    end

    subgraph Cowork GHC (Local Machine)
        GW[Remote Gateway Server]
        Proxy[Tool Permission Proxy]
        Runner[Branch Runner Engine]
        Runtime[OpenCode Runtime Sessions]
    end

    %% Communication Flow
    Orch -->|REST/WS Commands| GW
    GW -->|Validate Token| GW
    GW -->|Trigger Tasks| Runner
    Runner -->|Request Permission| Proxy
    Proxy -->|Local Approval / Auto-Rules| Proxy
    Runner -->|Spawn Isolated Session| Runtime
```

---

## 2. D1 Integration Seams & Interfaces

To integrate the **D1 Dispatch backend**, the following local components are exposed as integration surfaces:

### A. Task Dispatch API (`POST /api/tasks/run`)
Allows D1 Dispatch to submit a complete `TaskDefinition` to be executed locally.
- **Payload**: Consumes `TaskDefinition` including loop policy and agent specifications.
- **Validation**: Enforces `isNarrowingPreset` to ensure custom D1 agents do not bypass local permission limits.
- **Concurrency**: Automatically schedules up to 5 concurrent sessions locally, isolating files per branch.

### B. Live Session Event Stream (`GET /api/stream`)
SSE-based server-sent events that stream real-time execution frames back to the D1 Dispatch backend:
- `session.started`
- `runtime.output` (redacted logs/tokens)
- `permission.asked` (requires human validation or pre-approved rule matching)
- `session.terminal` (success/failure status with evidence hashes)

### C. D1 Dispatch UI (Pairing Screen)
- **Pairing QR Code**: When opening the D1 Dispatch screen, it will display a QR code to facilitate pairing/connection setup with the D1 Cloud Backend.

---

## 3. Recommended Roadmap for D1 Integration

```
[Phase 1: Secure Tunneling] ──> [Phase 2: Live Tool Consumption] ──> [Phase 3: Packaged Smoke Tests]
```

### Phase 1: Secure Tunneling (Keyring & TLS Hardening)
- Move device tokens from volatile in-memory storage to the Windows Credential Manager (Keyring).
- Establish HTTPS on local LAN with self-signed certificate fingerprint exchange during pairing.

### Phase 2: Live Tool Consumption & Mock-Free Validation
- Connect the D1 backend to a running OpenCode instance.
- Verify that a D1-orchestrated branch can consume local file tools successfully via the permission gate.

### Phase 3: Packaged Verification
- Execute end-to-end integration workflows using the production packaged build (`electron-builder`).
- Collect visual and file-state evidence showing correct execution results.

---

## 4. Key Gaps & Mitigations for Team D1

| Gaps / Gated Items | Impact | Mitigation Plan |
|---|---|---|
| **No Inbound Public IP** | D1 Cloud cannot direct-call local app. | Use the `tunnel` adapter (VPN/Tailscale) or outbound long-polling/WS connection from the Gateway to D1. |
| **Volatile Pairing** | Restarting local app breaks connection. | Persist the pairing registry to Windows Keyring using `@napi-rs/keyring`. |
| **Concurrency Hard Cap** | Risk of HTTP 429 / resource exhaustion. | Enforce local hardware resource guards (clamp concurrency <= 5) in `effectiveConcurrency`. |

---

## 5. Proposed Slash Command & Skills Registry Design

To support slash commands (e.g. `/prompt`, `/skill`, `/summarize`) dynamically without hardcoding them in `app-shell.ts`, the following design is proposed:

### A. Directory Structure
```text
app/ui/src/commands/
  ├── index.ts           # Exports registry interfaces & helpers
  ├── registry.ts        # The CommandRegistry singleton
  └── handlers/          # Individual command handlers
      ├── remote.ts      # Handles /remote command (moved here)
      ├── skills.ts      # Handles mapping of skills to commands (e.g. /summarize -> cowork.summarize)
      └── prompts.ts     # Handles custom prompts triggers
```

### B. Command Registry Seam
A singleton registry class to register and dispatch slash commands:

```typescript
export interface CommandContext {
  readonly client: ServiceClient;
  readonly activeSessionId: string | null;
  readonly arguments: readonly string[];
}

export type CommandHandler = (ctx: CommandContext) => Promise<void> | void;

export class CommandRegistry {
  private readonly commands = new Map<string, CommandHandler>();

  register(name: string, handler: CommandHandler): void {
    this.commands.set(name.toLowerCase(), handler);
  }

  dispatch(name: string, ctx: CommandContext): boolean {
    const handler = this.commands.get(name.toLowerCase());
    if (handler === undefined) return false;
    void handler(ctx);
    return true;
  }
}
```

### C. Integrating with Skills
When a user enters a command like `/summarize "text to summarize"`, the `skills` handler:
1. Intercepts the slash command via the dynamic registry.
2. Formats the parameters and invokes the backend's skill execution endpoint via `ServiceClient.exercise("cowork.summarize", { text: ... })`.
3. Streams the outcome back to the chat view.

