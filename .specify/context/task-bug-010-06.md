<!-- task=TASK-BUG-010-06 tokens~183 -->


---
## TASK

# Task: TASK-BUG-010-06


---
## ACCEPTANCE CRITERIA

- [ ] All existing unit tests pass: `go test ./internal/api/... -v`
- [ ] All existing integration tests pass: `go test -tags=integration ./tests/integration/... -v`
- [ ] Manual test: GET /api/products returns list including newly created product
- [ ] Manual test: GET /api/products/1 returns product details
- [ ] Manual test: POST /api/products/1/repos (with existing product) returns 201 Created
- [ ] Manual test: POST /api/products/999/repos (non-existent product) returns 404 Not Found
- [ ] Manual test: DELETE /api/products/1/repos/1 returns 200 OK (if repo exists)
- [ ] Manual test: PUT /api/products/1/repos/1 returns 200 OK with updated association
- [ ] No test failures or regressions detected