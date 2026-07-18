<!-- task=TASK-BUG-010-01 tokens~3173 -->


---
## TASK

# Task: TASK-BUG-010-01
**✅ COMPLETE**


---
## ACCEPTANCE CRITERIA

- [ ] Function signature is `func (s *Server) handleCreateProduct(w http.ResponseWriter, r *http.Request)`
- [ ] Request body is decoded using `json.NewDecoder(r.Body).Decode(&req)`
- [ ] Validation checks: name not empty, slug not empty, slug matches pattern `^[a-z0-9-]+$`
- [ ] Returns 400 Bad Request with error message if validation fails
- [ ] Calls `s.db.CreateProduct(ctx, req.Name, req.Slug, req.Description, req.Tags)`
- [ ] Returns 409 Conflict if slug already exists (check error message contains "UNIQUE constraint")
- [ ] Returns 500 Internal Server Error if database call fails (other errors)
- [ ] Fetches created product using `s.db.GetProduct(ctx, productID)` after creation
- [ ] Returns 201 Created with `ProductResponse` in response body
- [ ] Logs info event on success: `slog.InfoContext(ctx, "product created", "product_id", productID, "slug", req.Slug)`
- [ ] Logs error event on failure: `slog.ErrorContext(ctx, "failed to create product", "error", err)`

---
## CODE SCOPE

<!-- 1 files -->

### src/Backend/internal/api/handlers_products.go
```
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"

	"github.com/dungpd4/rad-system/internal/metadata"
)

// Product types for API responses

type ProductResponse struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	Slug        string   `json:"slug"`
	Description string   `json:"description,omitempty"`
	Status      string   `json:"status"`
	Tags        []string `json:"tags,omitempty"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

type RepoAssociationResponse struct {
	RepoID       int64   `json:"repo_id"`
	ProductID    int64   `json:"product_id"`
	Path         string  `json:"path"`
	Role         string  `json:"role"`
	DisplayName  string  `json:"display_name,omitempty"`
	SearchWeight float64 `json:"search_weight"`
	CreatedAt    string  `json:"created_at,omitempty"`
	UpdatedAt    string  `json:"updated_at,omitempty"`
}

type AddRepoRequest struct {
	Path        string  `json:"path"`
	Role        string  `json:"role"`
	DisplayName string  `json:"display_name,omitempty"`
	SearchWeight float64 `json:"search_weight,omitempty"`
}

type UpdateRepoRequest struct {
	DisplayName  *string  `json:"display_name"`
	Role         *string  `json:"role"`
	SearchWeight *float64 `json:"search_weight"`
}

// handleGetProducts returns all products
func (s *Server) handleGetProducts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	products, err := s.db.GetProducts(ctx)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to get products: %w", err))
		return
	}

	responses := make([]ProductResponse, 0)
	for _, p := range products {
		responses = append(responses, ProductResponse{
			ID:          p.ID,
			Name:        p.Name,
			Slug:        p.Slug,
			Description: p.Description,
			Status:      p.Status,
			Tags:        p.Tags,
			CreatedAt:   p.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt:   p.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"products": responses,
	})
}

// handleCreateProduct creates a new product
func (s *Server) handleCreateProduct(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string   `json:"name"`
		Slug        string   `json:"slug"`
		Description string   `json:"description,omitempty"`
		Tags        []string `json:"tags,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid request: %w", err))
		return
	}

	if req.Name == "" || req.Slug == "" {
		respondError(w, http.StatusBadRequest, fmt.Errorf("name and slug are required"))
		return
	}

	ctx := r.Context()
	productID, err := s.db.CreateProduct(ctx, req.Name, req.Slug, req.Description, req.Tags)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to create product: %w", err))
		return
	}

	// Retrieve the created product
	product, err := s.db.GetProduct(ctx, productID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to retrieve created product: %w", err))
		return
	}

	response := ProductResponse{
		ID:          product.ID,
		Name:        product.Name,
		Slug:        product.Slug,
		Description: product.Description,
		Status:      product.Status,
		Tags:        product.Tags,
		CreatedAt:   product.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   product.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	respondJSON(w, http.StatusCreated, response)
}

// handleGetProduct returns a specific product by ID
func (s *Server) handleGetProduct(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	productIDStr := vars["product_id"]

	productID, err := strconv.ParseInt(productIDStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid product_id"))
		return
	}

	ctx := r.Context()
	product, err := s.db.GetProduct(ctx, productID)
	if err != nil {
		respondError(w, http.StatusNotFound, fmt.Errorf("product not found"))
		return
	}

	response := ProductResponse{
		ID:          product.ID,
		Name:        product.Name,
		Slug:        product.Slug,
		Description: product.Description,
		Status:      product.Status,
		Tags:        product.Tags,
		CreatedAt:   product.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   product.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	respondJSON(w, http.StatusOK, response)
}

// handleDeleteProduct deletes a product by ID
func (s *Server) handleDeleteProduct(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	productIDStr := vars["product_id"]

	productID, err := strconv.ParseInt(productIDStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid product_id"))
		return
	}

	ctx := r.Context()

	// Verify product exists
	product, err := s.db.GetProduct(ctx, productID)
	if err != nil {
		respondError(w, http.StatusNotFound, fmt.Errorf("product not found"))
		return
	}

	// Update product status to deleted instead of removing
	deletedProduct := &metadata.Product{
		ID:          product.ID,
		Name:        product.Name,
		Slug:        product.Slug,
		Description: product.Description,
		Status:      "deleted",
		Tags:        product.Tags,
		CreatedAt:   product.CreatedAt,
		UpdatedAt:   time.Now(),
	}

	if err := s.db.UpdateProduct(ctx, deletedProduct); err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to delete product: %w", err))
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Product deleted successfully",
	})
}

// handleGetProductRepos returns all repositories associated with a product
func (s *Server) handleGetProductRepos(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	productIDStr := vars["product_id"]

	productID, err := strconv.ParseInt(productIDStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid product_id"))
		return
	}

	ctx := r.Context()

	// Check if product exists, but don't fail if it doesn't
	// (for backwards compatibility with existing setups without products)
	_, err = s.db.GetProduct(ctx, productID)
	if err != nil {
		// Product doesn't exist, return empty repos list instead of 404
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"repos": []RepoAssociationResponse{},
		})
		return
	}

	repos, err := s.db.GetProductRepos(ctx, productID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to get repos: %w", err))
		return
	}

	responses := make([]RepoAssociationResponse, 0)
	for _, repo := range repos {
		responses = append(responses, RepoAssociationResponse{
			RepoID:       repo.RepoID,
			ProductID:    repo.ProductID,
			Path:         repo.Path,
			Role:         repo.Role,
			DisplayName:  repo.DisplayName,
			SearchWeight: repo.SearchWeight,
		})
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"repos": responses,
	})
}

// handleAddRepoToProduct adds a repository to a product
func (s *Server) handleAddRepoToProduct(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	productIDStr := vars["product_id"]

	productID, err := strconv.ParseInt(productIDStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid product_id"))
		return
	}

	var req AddRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid request: %w", err))
		return
	}

	if req.Path == "" {
		respondError(w, http.StatusBadRequest, fmt.Errorf("path is required"))
		return
	}

	if req.Role == "" {
		req.Role = "service"
	}

	if req.SearchWeight == 0 {
		req.SearchWeight = 1.0
	}

	ctx := r.Context()

	// Check if product exists, auto-create if not
	_, err = s.db.GetProduct(ctx, productID)
	if err != nil {
		// Product doesn't exist - auto-create default product
		_, createErr := s.db.CreateProduct(ctx, 
			fmt.Sprintf("Product %d", productID), 
			fmt.Sprintf("product-%d", productID), 
			"", nil)
		if createErr != nil {
			respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to create product: %w", createErr))
			return
		}
	}

	repo, err := s.db.AddRepoToProduct(ctx, productID, req.Path, req.Role, req.DisplayName, req.SearchWeight)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to add repo: %w", err))
		return
	}

	response := RepoAssociationResponse{
		RepoID:       repo.RepoID,
		ProductID:    repo.ProductID,
		Path:         repo.Path,
		Role:         repo.Role,
		DisplayName:  repo.DisplayName,
		SearchWeight: repo.SearchWeight,
	}

	respondJSON(w, http.StatusCreated, response)
}

// handleRemoveRepoFromProduct removes a repository from a product
func (s *Server) handleRemoveRepoFromProduct(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	productIDStr := vars["product_id"]
	repoIDStr := vars["repo_id"]

	productID, err := strconv.ParseInt(productIDStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid product_id"))
		return
	}

	repoID, err := strconv.ParseInt(repoIDStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid repo_id"))
		return
	}

	ctx := r.Context()

	// Check if product exists
	_, err = s.db.GetProduct(ctx, productID)
	if err != nil {
		respondError(w, http.StatusNotFound, fmt.Errorf("product not found"))
		return
	}

	if err := s.db.RemoveRepoFromProduct(ctx, productID, repoID); err != nil {
		if err.Error() == "repo not found" {
			respondError(w, http.StatusNotFound, fmt.Errorf("repository not found in product"))
			return
		}
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to remove repo: %w", err))
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Repository removed from product",
	})
}

// handleUpdateRepoAssociation updates a repository's association with a product
func (s *Server) handleUpdateRepoAssociation(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	productIDStr := vars["product_id"]
	repoIDStr := vars["repo_id"]

	productID, err := strconv.ParseInt(productIDStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid product_id"))
		return
	}

	repoID, err := strconv.ParseInt(repoIDStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid repo_id"))
		return
	}

	var req UpdateRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid request: %w", err))
		return
	}

	ctx := r.Context()

	// Check if product exists
	_, err = s.db.GetProduct(ctx, productID)
	if err != nil {
		respondError(w, http.StatusNotFound, fmt.Errorf("product not found"))
		return
	}

	repo, err := s.db.UpdateRepoAssociation(ctx, productID, repoID, req.Role, req.DisplayName, req.SearchWeight)
	if err != nil {
		if err.Error() == "repo not found" {
			respondError(w, http.StatusNotFound, fmt.Errorf("repository not found in product"))
			return
		}
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to update repo: %w", err))
		return
	}

	response := RepoAssociationResponse{
		RepoID:       repo.RepoID,
		ProductID:    repo.ProductID,
		Path:         repo.Path,
		Role:         repo.Role,
		DisplayName:  repo.DisplayName,
		SearchWeight: repo.SearchWeight,
	}

	respondJSON(w, http.StatusOK, response)
}
```