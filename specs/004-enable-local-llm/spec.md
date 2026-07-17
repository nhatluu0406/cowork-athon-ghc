# Feature Specification: Enable Local LLM with Cloud Fallback

**Feature Branch**: `dev/dung-m365-knowledge-graph`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "UI add setting enable llm local with cloud llm. if enable llm local use model in models folder."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enable Local LLM Processing (Priority: P1)

Users need the ability to configure the application to use locally-stored LLM models instead of cloud-based APIs, providing offline capability and reducing API costs for users with capable hardware.

**Why this priority**: This is the core feature that enables local processing. Without this, no local LLM capability exists.

**Independent Test**: Can be fully tested by configuring the local LLM setting, selecting a model from the models folder, and verifying that inference requests are processed locally without cloud API calls.

**Acceptance Scenarios**:

1. **Given** the user is in the settings/configuration UI, **When** they enable the "Use Local LLM" option, **Then** the system displays available models from the models folder
2. **Given** local LLM is enabled and a model is selected, **When** the user submits a prompt, **Then** the system processes it using the local model without cloud API calls
3. **Given** local LLM is enabled, **When** no models are available in the models folder, **Then** the system displays a clear message instructing the user how to add models

---

### User Story 2 - Cloud LLM Fallback (Priority: P2)

When local LLM processing is enabled but encounters errors (model loading failure, insufficient resources, processing timeout), the system should automatically fall back to the configured cloud LLM provider to ensure uninterrupted service.

**Why this priority**: Provides reliability and resilience. Users can benefit from local processing when it works, but won't be blocked when it doesn't.

**Independent Test**: Can be tested by simulating local model failure scenarios (missing model, corrupted model, out-of-memory) and verifying that the system seamlessly switches to cloud processing with appropriate user notification.

**Acceptance Scenarios**:

1. **Given** local LLM is enabled but the model fails to load, **When** the user submits a prompt, **Then** the system processes it via cloud LLM and notifies the user of the fallback
2. **Given** local LLM processing times out, **When** the timeout threshold is exceeded, **Then** the system cancels local processing and retries via cloud LLM
3. **Given** local LLM runs out of memory during processing, **When** the error occurs, **Then** the system gracefully falls back to cloud LLM without crashing

---

### User Story 3 - Model Management UI (Priority: P3)

Users need to view, select, and manage local LLM models stored in the models folder, including seeing model metadata (size, capabilities, format) to make informed selection decisions.

**Why this priority**: Enhances usability but the feature can work with basic file-picker or dropdown functionality initially.

**Independent Test**: Can be tested by placing multiple models in the models folder and verifying that the UI displays them with relevant metadata and allows selection.

**Acceptance Scenarios**:

1. **Given** multiple models exist in the models folder, **When** the user opens the local LLM settings, **Then** the system displays a list of available models with name, size, and format
2. **Given** the user selects a model from the list, **When** they save the configuration, **Then** the system validates the model and marks it as the active local model
3. **Given** the models folder is empty, **When** the user enables local LLM, **Then** the system provides clear instructions and a link/button to download compatible models

---

### Edge Cases

- What happens when the models folder contains invalid or corrupted model files?
- How does the system handle partial model downloads or incomplete model files?
- What happens when disk space runs out during model loading?
- How does the system behave if the user deletes or moves the active model file while the application is running?
- What happens when switching from cloud to local mode mid-conversation with an active session?
- How does the system handle concurrent requests when local model has limited parallelism?
- What happens if the user's hardware doesn't meet minimum requirements for the selected model?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a UI setting to enable/disable local LLM processing
- **FR-002**: System MUST scan the models folder for compatible LLM model files when local mode is enabled
- **FR-003**: System MUST allow users to select one model from the available local models as the active model
- **FR-004**: System MUST route inference requests to the local model when local LLM is enabled and active
- **FR-005**: System MUST detect local processing failures (model load error, timeout, resource exhaustion, inference error)
- **FR-006**: System MUST automatically fall back to the configured cloud LLM provider when local processing fails
- **FR-007**: System MUST notify users when fallback to cloud LLM occurs, including the reason for fallback
- **FR-008**: System MUST persist the user's local LLM configuration (enabled/disabled, selected model) across sessions
- **FR-009**: System MUST validate that selected local models are compatible with the application's inference engine
- **FR-010**: System MUST display clear error messages when models folder is empty, inaccessible, or contains no valid models

### Key Entities *(include if feature involves data)*

- **LLM Configuration**: User's settings for LLM mode (local/cloud/hybrid), selected local model path, fallback behavior preferences
- **Local Model Metadata**: Model file path, model name, model format (GGUF, ONNX, etc.), model size, compatibility status, last validation timestamp
- **Inference Request**: User prompt, selected model (local or cloud), processing status, fallback indicator, response content, processing time

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can successfully enable local LLM mode and process prompts locally within 10 seconds of model loading
- **SC-002**: System automatically falls back to cloud LLM within 5 seconds when local processing fails
- **SC-003**: Users can complete the local LLM configuration workflow (enable → select model → test) in under 2 minutes
- **SC-004**: Fallback notifications are displayed to users within 1 second of fallback decision
- **SC-005**: Local model selection persists across application restarts without requiring reconfiguration

## Assumptions

- Users have sufficient disk space to store at least one local LLM model (typically 2-8 GB)
- The "models folder" refers to a predefined directory path accessible to the application (e.g., `./models`, `~/cowork/models`, or user-configurable path)
- Compatible model formats are determined by the existing inference engine in the application (likely GGUF for llama.cpp-based, ONNX for transformer-based, or similar)
- Cloud LLM provider configuration already exists in the application (Anthropic, OpenAI, or custom provider)
- Local model inference uses existing runtime/inference engine integration (no new inference engine implementation required in this feature)
- Minimum hardware requirements for local model execution are documented separately or detected automatically
- Model downloading/acquisition is out of scope for this feature (users must manually place models in the models folder)
- Multi-model concurrent usage is out of scope for v1 (only one local model active at a time)
