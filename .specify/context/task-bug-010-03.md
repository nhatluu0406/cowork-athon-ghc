<!-- task=TASK-BUG-010-03 tokens~5129 -->


---
## TASK

# Task: TASK-BUG-010-03


---
## ACCEPTANCE CRITERIA

- [ ] Test function `TestHandleCreateProduct` exists
- [ ] Test case: valid product creation → 201 Created, response contains product with ID
- [ ] Test case: missing name → 400 Bad Request, error message mentions "name"
- [ ] Test case: missing slug → 400 Bad Request, error message mentions "slug"
- [ ] Test case: empty name → 400 Bad Request
- [ ] Test case: empty slug → 400 Bad Request
- [ ] Test case: invalid slug format (uppercase, spaces) → 400 Bad Request
- [ ] Test case: duplicate slug → 409 Conflict, error message mentions "already exists" or "duplicate"
- [ ] Test case: invalid JSON → 400 Bad Request
- [ ] All tests use table-driven pattern with `[]struct{name string; input string; wantStatus int}`
- [ ] Tests run successfully: `go test ./internal/api/... -v -run TestHandleCreateProduct`

---
## CODE SCOPE

<!-- 1 files -->

### src/Backend/internal/api/handlers_products_test.go
```
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/dungpd4/rad-system/internal/metadata"
)

// ─────────────────────────────────────────────────────────────────────────────
// prodMockDB — embeds MinimalMockDB, overrides product-related methods
// ─────────────────────────────────────────────────────────────────────────────

type prodMockDB struct {
	MinimalMockDB
	products    []*metadata.Product
	productsErr error
	product     *metadata.Product
	productErr  error
	repos       []*metadata.RepoAssociation
	reposErr    error
	assoc       *metadata.RepoAssociation
	addErr      error
	removeErr   string
	updateErr   string
}

func (m *prodMockDB) GetProducts(ctx context.Context) ([]*metadata.Product, error) {
	return m.products, m.productsErr
}
func (m *prodMockDB) GetProduct(ctx context.Context, id int64) (*metadata.Product, error) {
	return m.product, m.productErr
}
func (m *prodMockDB) GetProductRepos(ctx context.Context, productID int64) ([]*metadata.RepoAssociation, error) {
	return m.repos, m.reposErr
}
func (m *prodMockDB) AddRepoToProduct(ctx context.Context, productID int64, path, role, displayName string, searchWeight float64) (*metadata.RepoAssociation, error) {
	if m.addErr != nil {
		return nil, m.addErr
	}
	return m.assoc, nil
}
func (m *prodMockDB) CreateProduct(ctx context.Context, name, slug, description string, tags []string) (int64, error) {
	return 1, nil
}
func (m *prodMockDB) RemoveRepoFromProduct(ctx context.Context, productID, repoID int64) error {
	if m.removeErr != "" {
		return fmt.Errorf("%s", m.removeErr)
	}
	return nil
}
func (m *prodMockDB) UpdateRepoAssociation(ctx context.Context, productID, repoID int64, role *string, displayName *string, searchWeight *float64) (*metadata.RepoAssociation, error) {
	if m.updateErr != "" {
		return nil, fmt.Errorf("%s", m.updateErr)
	}
	return m.assoc, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

func newProdServer(db metadata.DB) *Server {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return &Server{db: db, logger: logger, router: mux.NewRouter()}
}

func makeProdRequest(method, path string, body interface{}) *http.Request {
	var buf *bytes.Buffer
	if body != nil {
		b, _ := json.Marshal(body)
		buf = bytes.NewBuffer(b)
	} else {
		buf = bytes.NewBuffer(nil)
	}
	req, _ := http.NewRequest(method, path, buf)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func decodeProdBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var result map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v
body: %s", err, rec.Body.String())
	}
	return result
}

func sampleProduct(id int64) *metadata.Product {
	return &metadata.Product{
		ID:        id,
		Name:      "Test Product",
		Slug:      "test-product",
		Status:    "active",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
}

func sampleAssoc(productID, repoID int64) *metadata.RepoAssociation {
	return &metadata.RepoAssociation{
		RepoID:       repoID,
		ProductID:    productID,
		Path:         "/repo/path",
		Role:         "service",
		SearchWeight: 1.0,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// handleGetProducts
// ─────────────────────────────────────────────────────────────────────────────

func TestHandleGetProducts_DBError(t *testing.T) {
	db := &prodMockDB{productsErr: fmt.Errorf("db error")}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("GET", "/api/products", nil)
	s.handleGetProducts(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
}

func TestHandleGetProducts_EmptyList(t *testing.T) {
	db := &prodMockDB{products: []*metadata.Product{}}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("GET", "/api/products", nil)
	s.handleGetProducts(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	body := decodeProdBody(t, rec)
	if _, ok := body["products"]; !ok {
		t.Fatal("response missing 'products' key")
	}
}

func TestHandleGetProducts_WithProducts(t *testing.T) {
	db := &prodMockDB{products: []*metadata.Product{
		sampleProduct(1),
		sampleProduct(2),
	}}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("GET", "/api/products", nil)
	s.handleGetProducts(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	body := decodeProdBody(t, rec)
	prods, ok := body["products"].([]interface{})
	if !ok {
		t.Fatal("products is not an array")
	}
	if len(prods) != 2 {
		t.Fatalf("want 2 products, got %d", len(prods))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// handleGetProduct
// ─────────────────────────────────────────────────────────────────────────────

func TestHandleGetProduct_InvalidID(t *testing.T) {
	s := newProdServer(&prodMockDB{})
	rec := httptest.NewRecorder()
	req := makeProdRequest("GET", "/api/products/abc", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "abc"})
	s.handleGetProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHandleGetProduct_DBError(t *testing.T) {
	db := &prodMockDB{productErr: fmt.Errorf("not found")}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("GET", "/api/products/1", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleGetProduct(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestHandleGetProduct_Success(t *testing.T) {
	db := &prodMockDB{product: sampleProduct(1)}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("GET", "/api/products/1", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleGetProduct(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// handleGetProductRepos
// ─────────────────────────────────────────────────────────────────────────────

func TestHandleGetProductRepos_InvalidID(t *testing.T) {
	s := newProdServer(&prodMockDB{})
	rec := httptest.NewRecorder()
	req := makeProdRequest("GET", "/api/products/bad/repos", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "bad"})
	s.handleGetProductRepos(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHandleGetProductRepos_GetProductError_ReturnsEmpty(t *testing.T) {
	// When product does not exist, handler returns empty repos (200), not 404
	db := &prodMockDB{productErr: fmt.Errorf("not found")}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("GET", "/api/products/1/repos", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleGetProductRepos(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 (empty repos), got %d", rec.Code)
	}
	body := decodeProdBody(t, rec)
	repos, ok := body["repos"].([]interface{})
	if !ok {
		t.Fatal("repos is not an array")
	}
	if len(repos) != 0 {
		t.Fatalf("want 0 repos, got %d", len(repos))
	}
}

func TestHandleGetProductRepos_GetProductReposError(t *testing.T) {
	db := &prodMockDB{
		product:  sampleProduct(1),
		reposErr: fmt.Errorf("db error"),
	}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("GET", "/api/products/1/repos", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleGetProductRepos(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
}

func TestHandleGetProductRepos_Success(t *testing.T) {
	db := &prodMockDB{
		product: sampleProduct(1),
		repos:   []*metadata.RepoAssociation{sampleAssoc(1, 10)},
	}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("GET", "/api/products/1/repos", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleGetProductRepos(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	body := decodeProdBody(t, rec)
	if _, ok := body["repos"]; !ok {
		t.Fatal("response missing 'repos' key")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// handleAddRepoToProduct
// ─────────────────────────────────────────────────────────────────────────────

func TestHandleAddRepoToProduct_InvalidProductID(t *testing.T) {
	s := newProdServer(&prodMockDB{})
	rec := httptest.NewRecorder()
	req := makeProdRequest("POST", "/api/products/bad/repos", map[string]interface{}{"path": "/a"})
	req = mux.SetURLVars(req, map[string]string{"product_id": "bad"})
	s.handleAddRepoToProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHandleAddRepoToProduct_InvalidJSON(t *testing.T) {
	s := newProdServer(&prodMockDB{})
	rec := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/products/1/repos", bytes.NewBufferString("not-json"))
	req.Header.Set("Content-Type", "application/json")
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleAddRepoToProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHandleAddRepoToProduct_EmptyPath(t *testing.T) {
	s := newProdServer(&prodMockDB{product: sampleProduct(1)})
	rec := httptest.NewRecorder()
	req := makeProdRequest("POST", "/api/products/1/repos", map[string]interface{}{"path": ""})
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleAddRepoToProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHandleAddRepoToProduct_GetProductErrorAndCreateProductError(t *testing.T) {
	// GetProduct fails AND CreateProduct also fails → 500
	db := &prodMockDB{productErr: fmt.Errorf("not found")}
	// Override CreateProduct to fail
	db2 := &prodMockDBWithCreateErr{prodMockDB: *db, createErr: fmt.Errorf("create failed")}
	s := newProdServer(db2)
	rec := httptest.NewRecorder()
	req := makeProdRequest("POST", "/api/products/1/repos", map[string]interface{}{"path": "/repo"})
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleAddRepoToProduct(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
}

func TestHandleAddRepoToProduct_GetProductErrorCreateOKAddRepoFails(t *testing.T) {
	// GetProduct fails, CreateProduct ok, AddRepoToProduct fails → 500
	db := &prodMockDB{
		productErr: fmt.Errorf("not found"),
		addErr:     fmt.Errorf("add failed"),
	}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("POST", "/api/products/1/repos", map[string]interface{}{"path": "/repo"})
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleAddRepoToProduct(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
}

func TestHandleAddRepoToProduct_GetProductOKAddRepoFails(t *testing.T) {
	db := &prodMockDB{
		product: sampleProduct(1),
		addErr:  fmt.Errorf("add failed"),
	}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("POST", "/api/products/1/repos", map[string]interface{}{"path": "/repo"})
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleAddRepoToProduct(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
}

func TestHandleAddRepoToProduct_Success_DefaultRoleAndWeight(t *testing.T) {
	assoc := sampleAssoc(1, 10)
	assoc.Role = "service"
	assoc.SearchWeight = 1.0
	db := &prodMockDB{
		product: sampleProduct(1),
		assoc:   assoc,
	}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	// Send only path, no role or search_weight → should default
	req := makeProdRequest("POST", "/api/products/1/repos", map[string]interface{}{"path": "/repo"})
	req = mux.SetURLVars(req, map[string]string{"product_id": "1"})
	s.handleAddRepoToProduct(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d — %s", rec.Code, rec.Body.String())
	}
	body := decodeProdBody(t, rec)
	if role, _ := body["role"].(string); role != "service" {
		t.Fatalf("want role=service, got %q", role)
	}
	if weight, _ := body["search_weight"].(float64); weight != 1.0 {
		t.Fatalf("want search_weight=1.0, got %v", weight)
	}
}

// prodMockDBWithCreateErr embeds prodMockDB but overrides CreateProduct to fail
type prodMockDBWithCreateErr struct {
	prodMockDB
	createErr error
}

func (m *prodMockDBWithCreateErr) CreateProduct(ctx context.Context, name, slug, description string, tags []string) (int64, error) {
	if m.createErr != nil {
		return 0, m.createErr
	}
	return 1, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// handleRemoveRepoFromProduct
// ─────────────────────────────────────────────────────────────────────────────

func TestHandleRemoveRepoFromProduct_InvalidProductID(t *testing.T) {
	s := newProdServer(&prodMockDB{})
	rec := httptest.NewRecorder()
	req := makeProdRequest("DELETE", "/api/products/bad/repos/1", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "bad", "repo_id": "1"})
	s.handleRemoveRepoFromProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHandleRemoveRepoFromProduct_InvalidRepoID(t *testing.T) {
	s := newProdServer(&prodMockDB{})
	rec := httptest.NewRecorder()
	req := makeProdRequest("DELETE", "/api/products/1/repos/bad", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "bad"})
	s.handleRemoveRepoFromProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHandleRemoveRepoFromProduct_GetProductError(t *testing.T) {
	db := &prodMockDB{productErr: fmt.Errorf("not found")}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("DELETE", "/api/products/1/repos/10", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "10"})
	s.handleRemoveRepoFromProduct(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestHandleRemoveRepoFromProduct_RepoNotFound(t *testing.T) {
	db := &prodMockDB{
		product:   sampleProduct(1),
		removeErr: "repo not found",
	}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("DELETE", "/api/products/1/repos/10", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "10"})
	s.handleRemoveRepoFromProduct(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestHandleRemoveRepoFromProduct_OtherError(t *testing.T) {
	db := &prodMockDB{
		product:   sampleProduct(1),
		removeErr: "internal db failure",
	}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("DELETE", "/api/products/1/repos/10", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "10"})
	s.handleRemoveRepoFromProduct(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
}

func TestHandleRemoveRepoFromProduct_Success(t *testing.T) {
	db := &prodMockDB{product: sampleProduct(1)}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("DELETE", "/api/products/1/repos/10", nil)
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "10"})
	s.handleRemoveRepoFromProduct(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// handleUpdateRepoAssociation
// ─────────────────────────────────────────────────────────────────────────────

func TestHandleUpdateRepoAssociation_InvalidProductID(t *testing.T) {
	s := newProdServer(&prodMockDB{})
	rec := httptest.NewRecorder()
	req := makeProdRequest("PATCH", "/api/products/bad/repos/1", map[string]interface{}{})
	req = mux.SetURLVars(req, map[string]string{"product_id": "bad", "repo_id": "1"})
	s.handleUpdateRepoAssociation(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHandleUpdateRepoAssociation_InvalidRepoID(t *testing.T) {
	s := newProdServer(&prodMockDB{})
	rec := httptest.NewRecorder()
	req := makeProdRequest("PATCH", "/api/products/1/repos/bad", map[string]interface{}{})
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "bad"})
	s.handleUpdateRepoAssociation(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHandleUpdateRepoAssociation_InvalidJSON(t *testing.T) {
	s := newProdServer(&prodMockDB{product: sampleProduct(1)})
	rec := httptest.NewRecorder()
	req, _ := http.NewRequest("PATCH", "/api/products/1/repos/10", bytes.NewBufferString("bad-json"))
	req.Header.Set("Content-Type", "application/json")
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "10"})
	s.handleUpdateRepoAssociation(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestHandleUpdateRepoAssociation_GetProductError(t *testing.T) {
	db := &prodMockDB{productErr: fmt.Errorf("not found")}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("PATCH", "/api/products/1/repos/10", map[string]interface{}{})
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "10"})
	s.handleUpdateRepoAssociation(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestHandleUpdateRepoAssociation_RepoNotFound(t *testing.T) {
	db := &prodMockDB{
		product:   sampleProduct(1),
		updateErr: "repo not found",
	}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("PATCH", "/api/products/1/repos/10", map[string]interface{}{})
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "10"})
	s.handleUpdateRepoAssociation(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestHandleUpdateRepoAssociation_OtherError(t *testing.T) {
	db := &prodMockDB{
		product:   sampleProduct(1),
		updateErr: "db crashed",
	}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("PATCH", "/api/products/1/repos/10", map[string]interface{}{})
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "10"})
	s.handleUpdateRepoAssociation(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
}

func TestHandleUpdateRepoAssociation_Success(t *testing.T) {
	db := &prodMockDB{
		product: sampleProduct(1),
		assoc:   sampleAssoc(1, 10),
	}
	s := newProdServer(db)
	rec := httptest.NewRecorder()
	req := makeProdRequest("PATCH", "/api/products/1/repos/10", map[string]interface{}{})
	req = mux.SetURLVars(req, map[string]string{"product_id": "1", "repo_id": "10"})
	s.handleUpdateRepoAssociation(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — %s", rec.Code, rec.Body.String())
	}
}
```