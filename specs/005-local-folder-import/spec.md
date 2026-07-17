# Feature Specification: Local Folder Import for Knowledge Graph

**Feature Branch**: `005-local-folder-import`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "Add local folder import capability to M365 Knowledge Graph system: Allow users to import and index documents from local file system directories without requiring Microsoft 365 API access. Support common file formats (PDF, DOCX, TXT, MD, XLSX) with automatic text extraction and parsing. Provide UI for users to add local folder sources, configure recursive scanning and file filters, and trigger manual or automatic sync. Extract metadata (filename, path, mtime, size, file type) and content from local files, chunk and embed the content, and store in existing PostgreSQL chunks table and Neo4j graph with proper source attribution. Implement permission model where local files can be marked as public or inherit OS-level ACLs. Add API endpoints /api/local/sources (CRUD for local folder sources) and /api/local/sync (trigger import). Integrate with existing /api/knowledge/query retrieval so UI chat can search across both M365 and local sources seamlessly. Support delta sync to detect file changes (added/modified/deleted) since last import. Ensure no conflict with existing M365 connectors - local and M365 sources coexist independently. Provide status tracking for import jobs (queued/running/completed/failed) with progress reporting. Handle edge cases: large files (chunking strategy), binary files (metadata only), symlinks (follow or skip), hidden files (configurable), file encoding detection, permission-denied errors (skip and log), duplicate filenames across sources (namespace by source ID). Security: validate paths to prevent directory traversal attacks, sandbox file parser operations, redact sensitive paths from logs, enforce workspace boundary if applicable. Performance: batch database inserts, streaming file reads for large files, background job processing to avoid blocking API requests. Testing: unit tests for file scanner and parsers, integration tests for end-to-end local import to retrieval flow, permission isolation tests. The feature should work on both Windows and Linux environments."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Basic Local Folder Import (Priority: P1)

As a knowledge worker, I want to import documents from a local folder into the knowledge graph so that I can search and query my local files alongside M365 content without needing Microsoft 365 API access.

**Why this priority**: This is the core capability that enables offline and air-gapped deployments. Without this, users cannot use the knowledge graph system without M365 connectivity.

**Independent Test**: Can be fully tested by adding a local folder path through the UI, triggering an import, and verifying that documents appear in search results. Delivers immediate value by making local files searchable.

**Acceptance Scenarios**:

1. **Given** I have a folder with 50 text documents on my local disk, **When** I add the folder path as a local source and trigger import, **Then** all 50 documents are indexed and appear in search results
2. **Given** I have imported local documents, **When** I perform a knowledge query through the chat UI, **Then** results include matches from both local and M365 sources with clear source attribution
3. **Given** I have configured a local source, **When** I view the source status, **Then** I see accurate counts of files imported, total size, and last sync timestamp

---

### User Story 2 - Recursive Scanning with File Filters (Priority: P2)

As a knowledge worker with organized document hierarchies, I want to recursively scan subdirectories and filter by file types so that I can import only relevant documents from deep folder structures.

**Why this priority**: Real-world document repositories are organized in nested folders. Without recursive scanning and filtering, users would need to manually add many individual folders or import unwanted files.

**Independent Test**: Can be tested by creating a multi-level folder structure with mixed file types, configuring filters (e.g., "only PDF and DOCX"), and verifying that only matching files from all levels are imported.

**Acceptance Scenarios**:

1. **Given** I have a folder with 5 levels of subdirectories containing mixed file types, **When** I enable recursive scanning and import, **Then** files from all subdirectory levels are indexed
2. **Given** I configure file type filters to include only PDF and DOCX, **When** I import a folder with PDF, DOCX, TXT, and image files, **Then** only PDF and DOCX files are imported
3. **Given** I configure filters to exclude hidden files, **When** I import a folder containing `.gitignore` and `.DS_Store`, **Then** those hidden files are skipped

---

### User Story 3 - Delta Sync for Changed Files (Priority: P2)

As a knowledge worker who updates documents frequently, I want the system to detect and re-import only changed files so that my knowledge graph stays up-to-date without re-processing unchanged content.

**Why this priority**: Full re-imports are wasteful and slow for large document sets. Delta sync provides efficient updates and better user experience for ongoing usage.

**Independent Test**: Can be tested by importing a folder, modifying 3 out of 100 files, triggering sync again, and verifying that only the 3 changed files are re-processed while unchanged files are skipped.

**Acceptance Scenarios**:

1. **Given** I have previously imported 100 documents, **When** I modify 5 documents and trigger sync, **Then** only the 5 modified documents are re-processed
2. **Given** I have previously imported documents, **When** I add 3 new files to the folder and trigger sync, **Then** only the 3 new files are imported
3. **Given** I have previously imported documents, **When** I delete 2 files from the folder and trigger sync, **Then** those 2 files are removed from the knowledge graph and no longer appear in search results

---

### User Story 4 - File Format Support with Automatic Extraction (Priority: P1)

As a knowledge worker with diverse document types, I want automatic text extraction from PDF, DOCX, TXT, MD, and XLSX files so that I don't need to pre-process or convert my documents.

**Why this priority**: Multi-format support is essential for real-world usage. Users have documents in various formats and expect the system to handle them automatically.

**Independent Test**: Can be tested by creating sample files in each supported format containing known text, importing them, and verifying that the text is extractable and searchable.

**Acceptance Scenarios**:

1. **Given** I have a PDF document with text content, **When** I import it, **Then** the text is extracted and searchable in knowledge queries
2. **Given** I have a DOCX file with headings and paragraphs, **When** I import it, **Then** all text content is extracted including headings and body text
3. **Given** I have an XLSX spreadsheet with data in multiple sheets, **When** I import it, **Then** text content from all sheets is extracted
4. **Given** I have TXT and MD files with UTF-8 encoding, **When** I import them, **Then** all characters including special characters are correctly extracted

---

### User Story 5 - Import Status and Progress Tracking (Priority: P3)

As a knowledge worker importing large document sets, I want to see real-time progress and status so that I know how long the import will take and can identify any errors.

**Why this priority**: Provides transparency and better user experience, but the core import functionality works without detailed progress tracking.

**Independent Test**: Can be tested by starting an import of 500 files and verifying that status shows queued → running → completed with file counts and progress percentage.

**Acceptance Scenarios**:

1. **Given** I trigger an import of 500 files, **When** I view the job status, **Then** I see current progress (e.g., "150/500 files processed, 30% complete")
2. **Given** an import job encounters 5 permission-denied errors, **When** I view the job status, **Then** I see those errors logged with file paths and can proceed with remaining files
3. **Given** I have multiple import jobs running, **When** I view the status page, **Then** I see all jobs listed with their individual statuses (queued/running/completed/failed)

---

### User Story 6 - Manual and Automatic Sync Triggers (Priority: P3)

As a knowledge worker, I want to manually trigger imports when needed and optionally schedule automatic periodic syncs so that I control when updates happen.

**Why this priority**: Manual trigger is sufficient for MVP. Automatic scheduling is a convenience feature that enhances usability but isn't critical for initial adoption.

**Independent Test**: Can be tested by manually triggering a sync via UI button and verifying it completes, then optionally configuring an automatic schedule and verifying it runs at the specified interval.

**Acceptance Scenarios**:

1. **Given** I have configured a local source, **When** I click the "Sync Now" button, **Then** an import job starts immediately
2. **Given** I configure automatic sync to run daily at 2 AM, **When** the scheduled time arrives, **Then** an import job runs automatically
3. **Given** I disable automatic sync for a source, **When** the scheduled time arrives, **Then** no import job runs until I manually trigger it

---

### Edge Cases

- **Large files**: What happens when a file exceeds 100 MB? The system chunks it into smaller segments for processing and embeds each chunk separately, maintaining file continuity through metadata links.

- **Binary files without text**: How does the system handle image files or compiled binaries? The system stores metadata only (filename, size, path, mtime) without attempting text extraction, allowing them to be discoverable by filename but not content.

- **Symbolic links**: What happens when a folder contains symlinks to other directories? The system makes this configurable per source - users can choose whether to follow symlinks (with cycle detection to prevent infinite loops) or skip them entirely. The UI clearly explains the security implications: following symlinks may access directories outside the intended source scope. Default behavior is to skip symlinks for safety.

- **Permission-denied errors**: How does the system handle files it cannot read? The system logs the error with the file path (redacted if sensitive), skips the file, and continues processing remaining files. The job status shows count of skipped files.

- **Duplicate filenames**: What happens when two different sources contain files with the same name? The system namespaces files by source ID, so `project-a/report.pdf` and `project-b/report.pdf` are stored as distinct entities with unique identifiers.

- **File encoding detection**: How does the system handle text files in different encodings? The system attempts automatic encoding detection (UTF-8, UTF-16, Latin-1, etc.) and falls back to treating undetectable encodings as binary (metadata only).

- **Concurrent modifications**: What happens when a file is modified during import? The system captures a snapshot at the start of processing. If the file changes during processing, the next sync will detect it as modified and re-import.

- **Deleted source folders**: What happens when a configured source folder is deleted or becomes inaccessible? The system marks the source as "unavailable" in status, retains existing indexed content for read-only access, and allows users to either restore the path or permanently remove the source and its content.

- **Path traversal attacks**: How does the system prevent malicious paths like `../../etc/passwd`? The system validates and normalizes all paths, rejects paths attempting to escape the configured source root, and logs security violations.

- **Very deep directory hierarchies**: What happens with folder nesting beyond typical limits (e.g., 50+ levels)? The system processes recursively up to a configurable maximum depth (default: 100 levels) and logs a warning if the limit is reached.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to add local folder paths as document sources through a configuration interface
- **FR-002**: System MUST support recursive scanning of subdirectories when configured to do so
- **FR-003**: System MUST extract text content from PDF, DOCX, TXT, MD, and XLSX file formats
- **FR-004**: System MUST store extracted content as chunks in the existing PostgreSQL chunks table with source attribution
- **FR-005**: System MUST create or update graph nodes in Neo4j for imported documents with relationships to entities
- **FR-006**: System MUST detect file changes (added, modified, deleted) since the last import and process only deltas
- **FR-007**: System MUST provide REST API endpoints for managing local sources (create, read, update, delete at `/api/local/sources`)
- **FR-008**: System MUST provide REST API endpoint to trigger imports (`/api/local/sync`)
- **FR-009**: System MUST track import job status (queued, running, completed, failed) with progress metrics
- **FR-010**: System MUST integrate with existing `/api/knowledge/query` endpoint so searches return results from both local and M365 sources
- **FR-011**: System MUST allow users to configure file type filters (e.g., include only PDF and DOCX, exclude images)
- **FR-012**: System MUST allow users to configure whether to include or exclude hidden files (files starting with `.`)
- **FR-012a**: System MUST allow users to configure per source whether to follow symbolic links or skip them, with cycle detection when following is enabled
- **FR-013**: System MUST extract file metadata (filename, relative path, modification time, size, MIME type) for all imported files
- **FR-014**: System MUST handle permission-denied errors gracefully by skipping inaccessible files and logging the errors
- **FR-015**: System MUST validate folder paths to prevent directory traversal attacks
- **FR-016**: System MUST namespace imported files by source ID to handle duplicate filenames across sources
- **FR-017**: System MUST support manual triggering of imports through UI and API
- **FR-018**: System MUST process imports in background jobs without blocking API requests
- **FR-019**: System MUST work on both Windows and Linux file systems with path normalization
- **FR-020**: System MUST redact sensitive path components from logs and error messages
- **FR-021**: System MUST store last sync timestamp and file count statistics for each source
- **FR-022**: System MUST allow users to view import job history with status and error details
- **FR-023**: System MUST handle large files by streaming reads and chunking content for embedding
- **FR-024**: System MUST detect text encoding automatically and handle multiple encodings (UTF-8, UTF-16, Latin-1)
- **FR-025**: System MUST mark binary files (non-text) as metadata-only entries without text content extraction
- **FR-026**: System MUST batch database inserts for performance during large imports
- **FR-027**: Users MUST be able to delete a local source, which removes all imported content from that source
- **FR-028**: System MUST allow users to temporarily disable a source without deleting its content
- **FR-029**: System MUST coexist with existing M365 connectors without conflicts or data corruption
- **FR-030**: System MUST preserve existing M365 content when local sources are added or removed

### Key Entities

- **Local Source**: Represents a configured local folder path as a document source. Attributes include: unique ID, friendly name, absolute folder path, recursive scan enabled/disabled, file filter patterns (include/exclude), hidden file handling preference, symbolic link handling preference (follow/skip), enabled/disabled state, last sync timestamp, total file count, total size, status (active/unavailable).

- **Import Job**: Represents a single execution of the import process for a source. Attributes include: unique ID, source ID reference, status (queued/running/completed/failed), start time, end time, files processed count, files added count, files modified count, files deleted count, files skipped count, error messages, progress percentage.

- **Local Document**: Represents an imported file from a local source. Attributes include: unique ID, source ID reference, relative path within source, filename, file size, modification time, MIME type, encoding (for text files), is_binary flag, chunk count, hash of content for change detection. Relationships to chunks in PostgreSQL and entities in Neo4j.

- **Document Chunk**: Reuses existing PostgreSQL chunks table. Each chunk links to a document source (local or M365) with source type and source-specific identifier. Attributes include: chunk text, embedding vector, position in document, metadata JSON.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can successfully import 1,000 local documents and retrieve search results within 2 seconds
- **SC-002**: Text extraction accuracy reaches 95% for supported file formats (PDF, DOCX, TXT, MD, XLSX) measured against manually verified sample set
- **SC-003**: Delta sync processes 10,000-file repositories in under 5 minutes when only 50 files have changed
- **SC-004**: System handles files up to 500 MB without memory errors or process crashes
- **SC-005**: Search results correctly attribute sources, showing "Local: /path/to/file" vs "M365: OneDrive/file" in 100% of results
- **SC-006**: Import job error rate remains below 1% for valid, readable files (excluding permission-denied and corrupted files)
- **SC-007**: System imports 100 files per second on standard hardware (4-core CPU, 8GB RAM, SSD storage)
- **SC-008**: Users can complete the workflow "add source → configure filters → trigger import → see results in search" in under 3 minutes
- **SC-009**: Path validation prevents 100% of directory traversal attempts in security testing
- **SC-010**: Zero data corruption or conflicts occur when local and M365 sources are used concurrently

## Assumptions

- Users have read access to the local folders they wish to import (no privilege escalation is performed)
- Local file systems follow standard POSIX (Linux) or NTFS (Windows) conventions
- The existing PostgreSQL and Neo4j databases have sufficient capacity for additional local content (scaling is out of scope)
- Users understand that local imports do not provide the same permission granularity as M365 sources (all local files are readable by all authenticated users unless ACL inheritance is implemented)
- The system has sufficient disk space in temporary directories for file processing (minimum 10GB free recommended)
- File format parsers for PDF, DOCX, and XLSX are available as Go libraries (e.g., `pdfcpu`, `unioffice`, `excelize`)
- Background job queue infrastructure exists or will be implemented as part of this feature (no external job queue service like Redis required)
- Users accept that very large files (>500 MB) may have longer processing times or require manual chunking strategies
- The feature will reuse existing embedding and graph storage mechanisms without requiring schema changes
- Network file systems (NFS, SMB shares) are treated as local paths if mounted to the operating system
- Automatic scheduled sync is a stretch goal; manual trigger is the MVP requirement
- Users will configure sources through a web UI that communicates with the backend API (UI implementation details are specified separately)
- ACL inheritance from OS-level permissions is a future enhancement; MVP treats all imported files as publicly readable within the knowledge graph system
