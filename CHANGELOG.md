# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] — 2026-07-11

### Added
- Initial release: M365 Knowledge Graph extracted from parent MiniRag repository
- Backend: Go service with PostgreSQL + Neo4j
- LLM Service: Rust gRPC microservice for embedding, reranking, NER, compression
- Frontend: React/TypeScript dashboard (Q&A, entity browser, graph visualization)
- Documentation: Architecture, getting started, API reference
- Tests: Unit, integration, E2E smoke tests

### Technical
- **Backend**: Go 1.22+ with PostgreSQL driver, Neo4j driver, gRPC client
- **LLM Service**: Rust 1.70+ with tonic gRPC framework
- **Frontend**: React 18 + TypeScript 5 + TanStack Query v5
- **Database**: PostgreSQL 15 + Neo4j 5
- **Authentication**: Microsoft Entra ID (OAuth2) + JWT fallback

### Known Limitations
- LLM Service Phase 2: Local model inference (ONNX/GGUF) not yet implemented
- Frontend: Some advanced features deferred to Phase 2
- Documentation: Additional deployment guides to follow

### Migration Notes
- Extracted from https://github.com/rad-system/MiniRag on 2026-07-11
- Go module path: github.com/aifunction/m365-knowledge-graph
- Zero Ollama dependency (verified via security audit)
- All components independent of parent repository

[0.1.0]: 2026-07-11
