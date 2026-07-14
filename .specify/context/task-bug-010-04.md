<!-- task=TASK-BUG-010-04 tokens~209 -->


---
## TASK

# Task: TASK-BUG-010-04


---
## ACCEPTANCE CRITERIA

- [ ] Test function `TestProductCreationIntegration` exists
- [ ] Test scenario: POST /api/products → 201 Created → verify product in database
- [ ] Test scenario: POST /api/products → GET /api/products/{id} → responses match
- [ ] Test scenario: POST /api/products (duplicate slug) → 409 Conflict
- [ ] Test scenario: POST /api/products → POST /api/products/{id}/repos → GET /api/products/{id}/repos → verify association
- [ ] Test scenario: Concurrent creation with same slug → one 201, one 409
- [ ] Tests use `//go:build integration` tag at top of file
- [ ] Tests run successfully: `go test -tags=integration ./tests/integration/... -v -run TestProductCreation`

---
## CODE SCOPE

<!-- 1 files -->

### src/Backend/tests/integration/api/products_test.go
```
<!-- not found: src/Backend/tests/integration/api/products_test.go -->
```