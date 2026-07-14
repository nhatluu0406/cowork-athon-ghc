# Instructions for GitHub Copilot - RAD Knowledge Gateway Project

**Version**: 1.1 | **Based on**: `CLAUDE.md` v1.1 and Code Review Guildelines

This file provides essential context and instructions for AI assistants working on the RAD Knowledge Gateway project. Always adhere to these principles before generating or modifying code.

---

## 1. Core Mission

Your primary goal is to assist in developing the **RAD Knowledge Gateway**, an internal knowledge platform that treats source code as a **structured semantic graph**, not a block of text. The system focuses on high-precision retrieval, token reduction, and hallucination prevention.

---

## 2. P0: Non-Negotiable Core Invariants

These are the most critical rules. **Never violate them.**

-   **INVARIANT-1: Correctness > Performance:** Prioritize data integrity and consistency over speed.
-   **INVARIANT-2: Atomic Visibility:** An unpublished `Epoch` (a version of the index) must **never** be visible to users. All publishing operations must be within a database transaction.
-   **INVARIANT-3: Deterministic Indexing:** For a given pipeline version, an incremental index build must produce the exact same output as a full rebuild.
-   **INVARIANT-4: Crash Safety:** Use SQLite's WAL mode and atomic file writes (write to temp -> rename) to prevent partial writes from ever being visible.
-   **INVARIANT-5: Source Traceability:** Every piece of knowledge in the system must have a `source_ref` (file, line, commit). There is no "anonymous" knowledge.

---

## 3. The "Canonical Knowledge" Principle

-   **DO NOT** index raw legacy documents directly into the LLM context. This causes hallucinations.
-   **ALWAYS** follow the correct flow:
    1.  Extract knowledge from the **source code** (the source of truth).
    2.  Perform conflict detection against documents and tests (`FR-06`).
    3.  Generate a **Canonical Knowledge Document** that is verified and includes conflict warnings.
    4.  Use this canonical, traceable document for the LLM context.

---

## 4. Primary Workflow: Handling New Requirements with Specify

This project uses the **Specify framework** and its **9 `speckit` skills** to automate IPA-standard documentation and development. Follow this sequence strictly.

| Step | Action | Command | Output |
| :--- | :--- | :--- | :--- |
| **1** | **Generate Specification** | `/speckit-specify "Requirement description"` | `specs/REQ-XXX/spec.md` (IPA format) |
| **2** | **Clarify (Optional)** | `/speckit-clarify` | Refined `spec.md` with ambiguities removed |
| **3** | **Create Checklist** | `/speckit-checklist` | Test perspectives and IPA checklists |
| **4** | **Create Plan** | `/speckit-plan` | `specs/REQ-XXX/plan.md` (Phases, estimates) |
| **5** | **Generate Tasks** | `/speckit-tasks` | `specs/REQ-XXX/tasks.md` (Dev tasks in order) |
| **6** | **Analyze Quality** | `/speckit-analyze` | Consistency and risk report for docs |
| **7** | **Implement** | `/speckit-implement` | Track implementation against `tasks.md` |
| **8** | **Sync to GitHub** | `/speckit-taskstoissues` | Converts `tasks.md` to GitHub Issues |
| **9** | **Manage Principles** | `/speckit-constitution` | Manages `.specify/memory/constitution.md` |

**Key Rule:** Do not manually create specification documents. Always use the `/speckit-specify` command to ensure IPA compliance and traceability.

---

## 5. Go (Backend) Coding Conventions

### 5.1. Architecture & Packages
-   **`cmd/server`**: Entrypoint, DI, startup.
-   **`internal/`**: All private application logic.
    -   `api/`: HTTP handlers.
    -   `indexer/`: Orchestration logic.
    -   `retriever/`: Hybrid search logic.
    -   `epoch/`: **Critical** logic for atomic `Epoch` management.
    -   `metadata/`: SQLite database operations.
    -   `vectordb/`: LanceDB client.
-   **`pkg/types`**: Public, shared types (`Symbol`, `Epoch`, etc.).

### 5.2. Critical Go Patterns
-   **Error Handling**: Always wrap errors with context (`fmt.Errorf("...: %w", err)`). Do not ignore errors. Do not use `panic` in business logic.
-   **Database Transactions**: Any multi-step write operation **must** be inside a transaction (`db.WithTransaction(...)`). This is essential for `INVARIANT-2` and `INVARIANT-4`.
-   **Context Propagation**: Pass `context.Context` to all functions involving I/O, database calls, or API calls. Use `context.WithTimeout` for external calls.
-   **Interfaces**: Keep interfaces small and focused. Functions should accept interfaces and return structs.
-   **Logging**: Use the standard `slog` library for structured, contextual logging. **Do not use `fmt.Println`**.
-   **Concurrency**: Avoid goroutine leaks by selecting on `ctx.Done()`. Use mutexes or `sync.Map` for concurrent map access.

---

## 6. React/TypeScript (Frontend) Conventions

### 6.1. Tech Stack
-   **Framework**: React 18 + TypeScript + Vite
-   **UI**: Tailwind CSS + Shadcn/ui
-   **State Management**:
    -   **TanStack Query v5**: For all server state (API data).
    -   **Zustand v4**: For global UI state (e.g., search mode, theme).
-   **Validation**: Zod
-   **Testing**: Playwright for E2E tests.

### 6.2. Critical Frontend Patterns
-   **State Separation**:
    -   **Server State (API data) -> TanStack Query.** Do not store API responses in Zustand or `useState`.
    -   **Global UI State -> Zustand.**
    -   **Local Component State -> `useState`.**
-   **API Calls**:
    -   Use the centralized Axios client in `api/client.ts`. It contains interceptors for JWT token refresh.
    -   Create custom hooks with `useQuery` (e.g., `useJobs`) to fetch data.
    -   **Do not** use `fetch` directly inside components with `useEffect`.
-   **Internationalization (i18n)**:
    -   Use the `useTranslation` hook from `react-i18next`.
    -   Store all user-facing strings in JSON translation files (`public/locales/`).
    -   **Do not** hardcode English or Japanese text in components.
-   **WebSockets**: Use the `useWebSocket` custom hook, which handles reconnection logic. Use its `onMessage` callback to invalidate TanStack Query keys (`queryClient.invalidateQueries(...)`) to keep data fresh.

---

## 7. Testing Strategy

-   **P0 Correctness Tests**: These are the most important tests and must never be skipped. They verify that incremental indexing is identical to a full rebuild (`TestIncrementalEquivalence`).
-   **Unit Tests**: Form the base of the pyramid. Target >80% coverage for business logic, especially for the `epoch` and `retriever` packages.
-   **Integration Tests**: Test the interaction between components (e.g., API layer and indexer).
-   **E2E Tests (Playwright)**: Test critical user flows from the UI perspective.

---

## 8. Code Review Guidelines

**The following instructions are only to be applied when performing a code review.**

### 8.1. README Updates
-   [ ] The new file should be added to the `docs/README.<type>.md`.

### 8.2. Prompt File Guide (`.prompt.md`)
-   [ ] The prompt has markdown front matter.
-   [ ] The prompt has an `agent` field specified of either `agent`, `ask`, or `Plan`.
-   [ ] The prompt has a `description` field.
-   [ ] The `description` field is not empty.
-   [ ] The file name is lower case, with words separated by hyphens.
-   [ ] Encourage the use of `tools`, but it's not required.
-   [ ] Strongly encourage the use of `model` to specify the model that the prompt is optimised for.
-   [ ] Strongly encourage the use of `name` to set the name for the prompt.

### 8.3. Instruction File Guide (`.instructions.md`)
-   [ ] The instruction has markdown front matter.
-   [ ] The instruction has a `description` field.
-   [ ] The `description` field is not empty.
-   [ ] The file name is lower case, with words separated by hyphens.
-   [ ] The instruction has an `applyTo` field that specifies the file or files to which the instructions apply. If they wish to specify multiple file paths they should be formatted like `'**.js, **.ts'`.

### 8.4. Agent File Guide (`.agent.md`)
-   [ ] The agent has markdown front matter.
-   [ ] The agent has a `description` field.
-   [ ] The `description` field is not empty.
-   [ ] The file name is lower case, with words separated by hyphens.
-   [ ] Encourage the use of `tools`, but it's not required.
-   [ ] Strongly encourage the use of `model` to specify the model that the agent is optimised for.
-   [ ] Strongly encourage the use of `name` to set the name for the agent.

### 8.5. Agent Skills Guide (`skills/` directory)
-   [ ] The skill folder contains a `SKILL.md` file.
-   [ ] The SKILL.md has markdown front matter.
-   [ ] The SKILL.md has a `name` field.
-   [ ] The `name` field value is lowercase with words separated by hyphens.
-   [ ] The `name` field matches the folder name.
-   [ ] The SKILL.md has a `description` field.
-   [ ] The `description` field is not empty, at least 10 characters, and maximum 1024 characters.
-   [ ] The `description` field value is wrapped in single quotes.
-   [ ] The folder name is lower case, with words separated by hyphens.
-   [ ] Any bundled assets (scripts, templates, data files) are referenced in the SKILL.md instructions.
-   [ ] Bundled assets are reasonably sized (under 5MB per file).

### 8.6. Plugin Guide (`plugins/` directory)
-   [ ] The plugin directory contains a `.github/plugin/plugin.json` file.
-   [ ] The plugin directory contains a `README.md` file.
-   [ ] The plugin.json has a `name` field matching the directory name.
-   [ ] The plugin.json has a `description` field.
-   [ ] The `description` field is not empty.
-   [ ] The directory name is lower case, with words separated by hyphens.
-   [ ] If `tags` is present, it is an array of lowercase hyphenated strings.
-   [ ] If `items` is present, each item has `path` and `kind` fields.
-   [ ] The `kind` field value is one of: `prompt`, `agent`, `instruction`, `skill`, or `hook`.
-   [ ] The plugin does not reference non-existent files.