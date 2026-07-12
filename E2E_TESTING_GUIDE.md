# End-to-End Testing Guide (v1.0)

## Overview

This guide describes how to run comprehensive end-to-end tests with all services running together:
- **Backend**: Go service (PostgreSQL + Neo4j)
- **Frontend**: React app (TypeScript + Vite)
- **LLM Service**: Rust service (gRPC, llama-svc)

## Prerequisites

### System Requirements
- Go 1.21+
- Rust 1.96+
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 13+
- Neo4j 5+

### Environment Setup

1. **Create `.env` file** (root directory):
```bash
# Backend
DATABASE_URL=postgres://user:password@localhost:5432/m365_kg
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=neo4j_password
M365_TENANT_ID=your-tenant-id
M365_CLIENT_ID=your-client-id
M365_CLIENT_SECRET=your-client-secret
JWT_SECRET=your-jwt-secret
ALLOWED_ORIGINS=http://localhost:5173
DELTA_SYNC_INTERVAL=300s

# LLM Service
LLMSVC_ADDR=localhost:9090
LLM_EMBED_MODEL=sentence-transformers-mpnet
LLM_MODEL=gpt-4o-mini
LLM_API_BASE_URL=https://api.openai.com/v1  # or your cloud provider
LLM_API_KEY=your-api-key

# Frontend
VITE_API_URL=http://localhost:8000
```

2. **Start infrastructure**:
```bash
docker-compose up -d postgres neo4j
# Wait for databases to be healthy (~30s)
```

## Running Services

### 1. Start Backend
```bash
cd backend
go run cmd/main.go
# Output: "m365-knowledge-graph starting" 
# Verify: http://localhost:8000/health
```

### 2. Start LLM Service
```bash
cd llm-svc
cargo run --release
# Output: "Server listening on 0.0.0.0:9090"
# Health check: grpcurl localhost:9090 llmsvc.LlmSvc.Health
```

### 3. Start Frontend (Dev Server)
```bash
cd Frontend
npm run dev
# Output: "Local: http://localhost:5173"
```

### 4. Verify All Services
```bash
# Health checks
curl http://localhost:8000/health          # Backend
curl http://localhost:5173                 # Frontend (should show page)
# For llm-svc health, use grpcurl command above
```

## Running E2E Tests

### Frontend E2E Tests (Playwright)

**Setup** (one-time):
```bash
cd Frontend
npx playwright install  # Download browsers (Chromium, Firefox, WebKit)
```

**Run All Tests**:
```bash
cd Frontend
npm run test:e2e
# Output: "Running X tests using Y workers"
# Report: test-results/ directory
```

**Run Specific Test Suite**:
```bash
# Login flow only
npx playwright test login.spec.ts

# End-to-end flows only
npx playwright test end-to-end.spec.ts

# Dashboard tests only
npx playwright test end-to-end.spec.ts -g "Dashboard"

# Watch mode (rerun on changes)
npx playwright test --watch

# UI mode (interactive test runner)
npx playwright test --ui
```

**View Test Report**:
```bash
# After tests complete
npx playwright show-report test-results/
# Opens report in default browser
```

### Backend Integration Tests

**Run All Backend Tests**:
```bash
cd backend
go test ./...  # All tests, all packages
```

**Run Integration Tests** (requires DB):
```bash
go test -tags=integration ./tests/integration/...
# Tests skip gracefully if DB unavailable
```

**Run Specific Test**:
```bash
go test ./tests/integration/retrieval/... -run TestFullExtractionGraphQueryFlow -v
```

### LLM Service Tests

**Run All Tests**:
```bash
cd llm-svc
cargo test --lib
# 34 tests across ONNX, GGUF, Safetensors, routing, config
```

## Complete Flow Test Checklist

Use this checklist to validate a complete user journey:

### 1. **Authentication**
- [ ] Navigate to http://localhost:5173
- [ ] Redirected to `/login` 
- [ ] Enter credentials (if `DEV_LOGIN_USERNAME`/`DEV_LOGIN_PASSWORD` set)
- [ ] Login succeeds, token stored in localStorage
- [ ] Redirected to `/dashboard`

### 2. **Dashboard**
- [ ] Dashboard loads with stats (Documents, Entities, Connections)
- [ ] Sync status visible
- [ ] Recent queries displayed
- [ ] No console errors

### 3. **Knowledge Search**
- [ ] Navigate to `/search`
- [ ] Enter query: "What are the main projects?"
- [ ] Submit query
- [ ] Results displayed with answer and citations
- [ ] Response comes from backend API (`/api/knowledge/query`)
- [ ] Feedback buttons (thumbs up/down) visible

### 4. **Entity Browser**
- [ ] Navigate to `/entities`
- [ ] Entity list loads
- [ ] Can filter by type
- [ ] Click entity → detail view opens
- [ ] Relationships displayed

### 5. **Graph Visualization**
- [ ] Navigate to `/graph`
- [ ] Graph canvas renders
- [ ] Nodes and edges visible (from `/api/graph/nodes`, `/api/graph/edges`)
- [ ] Can filter by entity type
- [ ] Interaction works (hover, click)

### 6. **Data Sources**
- [ ] Navigate to `/sources`
- [ ] Existing connections displayed
- [ ] Sync status shown
- [ ] Can see sync triggers (manual sync button visible)
- [ ] Add new source form functional

### 7. **Permission Enforcement**
- [ ] Use different user accounts (mock via `X-User-ID` header)
- [ ] User A sees files they have access to
- [ ] User B sees only their own files
- [ ] Search results respect permissions (Stage 0 filter)
- [ ] Backend returns 403 for unauthorized entity access

### 8. **End-to-End Data Flow**
- [ ] Upload/connect M365 source (`POST /api/m365/connect`)
- [ ] Trigger sync (`POST /api/m365/sync`)
- [ ] Files appear in database
- [ ] Search finds indexed content
- [ ] Graph shows extracted entities
- [ ] Feedback on results (`POST /api/feedback`)

## Troubleshooting

### Common Issues

**Frontend won't connect to backend**:
```bash
# Check VITE_API_URL in Frontend/.env
# Should be http://localhost:8000
# Verify backend is running: curl http://localhost:8000/health
```

**Tests timeout**:
```bash
# Increase timeout in playwright.config.ts
# Or run with longer timeout:
npx playwright test --timeout=60000  # 60 seconds
```

**Database connection errors**:
```bash
# Verify PostgreSQL running
docker ps | grep postgres

# Check Neo4j running
docker ps | grep neo4j

# Verify credentials in .env match docker-compose.yml
```

**LLM Service unavailable**:
```bash
# If backend can't connect to llm-svc:
# - Verify LLMSVC_ADDR is correct (localhost:9090)
# - Check llm-svc is running: cargo run --release
# - System degrades gracefully, uses cloud API as fallback
```

## Performance Testing

### Load Testing Frontend
```bash
# Use k6 or similar for load testing
# Example with k6 (if installed):
k6 run --vus 100 --duration 30s ./Frontend/tests/load.js
```

### Latency Monitoring
```bash
# Monitor backend response times
cd backend
go test ./tests/integration/retrieval/... -v 2>&1 | grep -E "latency|ms"
```

### Database Performance
```bash
# Check query counts in query_logs table
psql -U postgres -d m365_kg -c "SELECT COUNT(*) FROM query_logs;"
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: E2E Tests
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:13
        env:
          POSTGRES_PASSWORD: password
      neo4j:
        image: neo4j:5
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
        working-directory: Frontend
      - run: npx playwright install --with-deps
        working-directory: Frontend
      - run: npm run test:e2e
        working-directory: Frontend
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: playwright-report
          path: Frontend/test-results/
```

## Manual Testing Scenarios

### Scenario 1: Ingest + Search
1. Start all services
2. Connect OneDrive source (Settings → Data Sources → Add)
3. Manually trigger sync
4. Wait for sync to complete (monitor in Dashboard)
5. Search for content from ingested files
6. Verify results appear with correct citations

### Scenario 2: Permission-Aware Retrieval
1. Create two users with different M365 access
2. Connect same source as both users
3. User A searches → sees their files
4. User B searches → sees only their files
5. Verify no cross-user data leakage

### Scenario 3: Graph Exploration
1. Ingest document with multiple entities
2. Go to Graph page
3. Explore relationships
4. Find path between two entities
5. Verify path matches ingested connections

### Scenario 4: Feedback Loop
1. Get a search result
2. Click helpful/unhelpful
3. Add feedback comment
4. Verify feedback stored (`/api/feedback` call succeeds)
5. Check feedback appears in admin dashboard

## Production Deployment Checklist

Before deploying to production:

- [ ] All E2E tests pass
- [ ] Backend unit tests (100% pass)
- [ ] LLM Service tests (100% pass)
- [ ] No database migration errors
- [ ] Neo4j schema created successfully
- [ ] Permission cache populated
- [ ] Search latency < 30 seconds (p95)
- [ ] No unhandled errors in logs
- [ ] CORS properly configured
- [ ] JWT secret unique per environment
- [ ] M365 credentials valid and scoped
- [ ] LLM API key valid and has quota
- [ ] Monitoring/logging configured
- [ ] Backup strategy in place

## Future Testing (v2.0)

- [ ] Load testing with realistic corpus (10K docs, 500K messages)
- [ ] GPU inference testing (T162 Safetensors)
- [ ] Multi-language testing
- [ ] Concurrent user testing (>50 simultaneous)
- [ ] Disaster recovery testing
- [ ] Long-running stability test (24+ hours)

## Resources

- **Playwright Docs**: https://playwright.dev/docs/intro
- **Backend Tests**: `backend/tests/` directory
- **LLM Service Tests**: `llm-svc/src/` (inline tests)
- **Frontend Tests**: `Frontend/tests/e2e/` directory
- **Docker Compose**: `docker-compose.yml` (infrastructure)

---

**Status**: This guide documents v1.0 end-to-end testing.  
**Last Updated**: 2026-07-12  
**Test Coverage**: Login, Dashboard, Search, Entities, Graph, Sources, Permissions, Feedback
