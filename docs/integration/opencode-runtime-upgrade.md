---
status: proposed
updated_at: 2026-07-15
---

# OpenCode runtime upgrade gate

## Current source

- Package pin: `1.17.11`
- Runtime pin: `v1.17.11`
- Cowork uses the headless HTTP server, SSE events, permission replies and a supervised child process.

## Candidate

Test OpenCode `1.18.1` in an isolated branch. If it breaks the Cowork server contract, fall back to `1.17.20` for the demo.

## Required compatibility matrix

- [ ] health/version
- [ ] session create
- [ ] prompt send
- [ ] first token streaming
- [ ] terminal/final response
- [ ] permission asked/replied
- [ ] create file
- [ ] modify file
- [ ] deny mutation
- [ ] cancel
- [ ] stop/no orphan
- [ ] native Skill discovery
- [ ] MCP local config
- [ ] MCP remote config

## Performance matrix

Capture median of three runs:

| Stage | 1.17.11 | candidate |
|---|---:|---:|
| prompt → first token | | |
| first token → tool request | | |
| permission approved → tool finished | | |
| tool finished → final response | | |
| total create turn | | |

Do not accept an upgrade that changes event semantics without mapper tests.
