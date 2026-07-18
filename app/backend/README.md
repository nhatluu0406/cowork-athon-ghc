# M365 Knowledge Graph Backend

Enterprise-grade knowledge graph from Microsoft 365 data with a unified, lightweight architecture optimized for local-first deployments.

## Architecture Overview

This backend implements a **unified stack** based on SQLite + LanceDB:

### SQLite + LanceDB (Single Stack)
- **Use Case**: Local-first, file-based, no external services (Cowork GHC Windows desktop app)
- **Database**: SQLite with WAL mode for concurrent read/write
- **Vector Store**: LanceDB for in-memory vector similarity search and embedding storage
- **Scale**: 10K-500K documents with efficient local processing
- **Deployment**: Windows desktop app, single-user, offline-capable

## Getting Started

### Prerequisites
- Go 1.21+
- For Option 1 only: PostgreSQL 15+ and Neo4j 5.x
- For Option 2 only: LanceDB dependencies (automatic via go.mod)

### Quick Start (SQLite + LanceDB)

```bash
# 1. Build the backend
cd /home/dungpham/m365-knowledge-graph/app/backend
go build -o m365kg ./cmd

# 2. Run with SQLite
./m365kg

# The app will create m365kg.db in the current directory
```

**Environment Variables**:
```bash
# Core settings (defaults work with no configuration needed)
DATABASE_URL=file:./m365kg.db?cache=shared  # (default, created automatically)
PORT=8080
JWT_SECRET=your-32-character-secret-key
ENVIRONMENT=development

# M365 Integration (required for data ingestion)
M365_TENANT_ID=your-tenant-id
M365_CLIENT_ID=your-app-registration-id
M365_CLIENT_SECRET=your-app-secret

# Optional: Connect to local llm-svc for embeddings and entity extraction
LLMSVC_ADDR=localhost:50051
```

## API Surface

### M365 Connection & Sync
- `POST /api/m365/connect` - Connect Microsoft 365 account
- `POST /api/m365/sync` - Trigger manual sync (or scheduled via background job)
- `GET /api/m365/sync/status` - Get sync progress
- `GET /api/m365/sources` - List connected sources

### Entity Management
- `GET /api/entities` - List entities with filters
- `GET /api/entities/{id}` - Entity details with related vectors
- `POST /api/entities/extract` - Extract entities from documents via LLM

### Retrieval & Q&A
- `POST /api/knowledge/query` - Query knowledge graph (8-stage hybrid pipeline)
- `GET /api/knowledge/query/{id}` - Retrieve past query results
- `POST /api/feedback/{query_id}` - Submit feedback (like/dislike/flag)
- `GET /api/feedback/stats` - Feedback analytics

### System
- `GET /api/stats/overview` - System metrics and counts
- `GET /api/health` - Health check

## Configuration

### Environment Variables

**Database**:
- `DATABASE_URL`: SQLite file path (default: `file:./m365kg.db?cache=shared`)
  - Automatically created if it doesn't exist
  - Can be absolute or relative path
  - For Windows: `file:///C:/Users/YourUsername/AppData/Local/Cowork GHC/m365kg.db?cache=shared`

**Microsoft 365**:
- `M365_TENANT_ID`: Azure AD tenant ID
- `M365_CLIENT_ID`: Azure app registration client ID
- `M365_CLIENT_SECRET`: Azure app registration client secret
- `DELTA_SYNC_INTERVAL`: Sync interval in seconds (default: 300s = 5 minutes)

**LLM Services**:
- `LLMSVC_ADDR`: gRPC address of llm-svc (e.g., `localhost:50051`)
- `LLMSVC_TLS`: Enable TLS for llm-svc (`true`/`false`)
- `LLMSVC_CERT_FILE`: Path to TLS certificate file

**Server**:
- `HOST`: Server host (default: `0.0.0.0`)
- `PORT`: Server port (default: `8080`)
- `ALLOWED_ORIGINS`: CORS allowed origins (comma-separated)
- `ENVIRONMENT`: `development`, `staging`, or `production`

**Security**:
- `JWT_SECRET`: HS256 signing key (min 32 characters)

## Building & Deployment

### Local Development

```bash
# Build and run with SQLite (default)
go build -o m365kg ./cmd
./m365kg

# Or run directly
go run ./cmd

# Database file m365kg.db will be created automatically
```

### Docker Build

```bash
# Build Docker image
docker build -t m365kg:latest .

# Run (no external services needed)
docker run -p 8080:8080 \
  -e JWT_SECRET=your-secret \
  -e M365_TENANT_ID=your-tenant \
  -e M365_CLIENT_ID=your-client \
  -e M365_CLIENT_SECRET=your-secret \
  m365kg:latest
```

### Production Deployment

**Cowork GHC (Windows Desktop)**:
- Install app with embedded SQLite + LanceDB
- Database file stored in: `%APPDATA%/Cowork GHC/m365kg.db`
- No external services required
- Offline-capable with periodic M365 sync
- Single-user, file-based architecture

## Testing

```bash
# Run all tests
go test -v ./...

# Run with coverage
go test -v ./... -cover

# Run integration tests only
go test -v -tags=integration ./tests/integration/...

# Benchmark performance
go test -bench=. -benchmem ./...
```

## Architecture Documents

- **Architecture**: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Dual-stack design, Option 1 vs Option 2 trade-offs
- **Integration**: [docs/INTEGRATION.md](./docs/INTEGRATION.md) - API contracts, WebSocket events, error codes
- **Data Model**: [../specs/REQ-204-M365-001-m365-knowledge-graph/data-model.md](../specs/REQ-204-M365-001-m365-knowledge-graph/data-model.md) - Database schemas and entity definitions

## Troubleshooting

### "DATABASE_URL is required"
- Set `DATABASE_URL` environment variable
- Default for SQLite: `file:./m365kg.db?cache=shared`
- Default for PostgreSQL: `postgres://user:pass@localhost:5432/m365kg`

### SQLite: "database is locked"
- Ensure only one process is writing to the database at a time
- SQLite WAL mode (enabled by default) allows concurrent readers
- Check `PRAGMA busy_timeout` setting (default: 5000ms)

### Neo4j: "unable to connect"
- Verify Neo4j is running: `neo4j console` or via Docker
- Check `NEO4J_URI` is correct (default: `bolt://localhost:7687`)
- Verify username/password match Neo4j instance

### M365 API throttling
- Implement exponential backoff (handled automatically)
- Check Microsoft Graph API limits: https://learn.microsoft.com/en-us/graph/throttling-guidance

## Performance Targets

- **Query Latency**: P95 ≤ 30 seconds (8-stage hybrid retrieval pipeline)
- **Sync Throughput**: 1K documents per minute (M365 delta sync)
- **Memory Usage**: < 500MB (SQLite + LanceDB on desktop)
- **Concurrent Connections**: 100+ concurrent reads (SQLite WAL mode)
- **Vector Search**: Cosine similarity over embeddings (sub-second latency)

## License

This is part of the Cowork GHC project. See [LICENSE](../../LICENSE) for details.

## Support

For issues, feature requests, or contributions:
1. Check [CLAUDE.md](../../CLAUDE.md) for project guidelines
2. Review [docs/](./docs/) for architecture and integration details
3. File an issue on the project repository
