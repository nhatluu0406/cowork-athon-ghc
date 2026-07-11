# M365 Knowledge Graph

An intelligent enterprise knowledge graph system that ingests data from Microsoft 365 (OneDrive, Teams, SharePoint), extracts business entities and relationships via NLP, and answers natural language questions with permission-aware, cited responses.

## Quick Start

### Prerequisites
- Go 1.22+
- Rust 1.70+
- Docker & Docker Compose
- PostgreSQL 15+
- Neo4j 5+

### Local Development

```bash
# Start infrastructure
docker-compose up -d

# Build and run backend
cd backend
go build -o bin/m365-knowledge-graph ./cmd
./bin/m365-knowledge-graph

# Build and run LLM service (new terminal)
cd llm-svc
cargo build --release
./target/release/llm-svc

# Frontend at http://localhost:3000
# Backend API at http://localhost:8080
# gRPC (llm-svc) at localhost:9090
```

## Architecture

- **Backend**: Go service with PostgreSQL metadata + Neo4j knowledge graph
- **LLM Service**: Rust gRPC microservice for all LLM operations
- **Frontend**: React/TypeScript dashboard
- **Database**: PostgreSQL + Neo4j

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Getting Started](docs/GETTING_STARTED.md)
- [API Reference](specs/contracts/api.md)
- [Data Model](specs/data-model.md)

## License

[Your License Here]

---

Extracted from MiniRag parent repository on 2026-07-11.
