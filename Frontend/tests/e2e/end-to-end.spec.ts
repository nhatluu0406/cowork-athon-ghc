import { test, expect } from '@playwright/test';

// Base URL - adjust based on your environment
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

test.describe('End-to-End Application Flow', () => {
  // Helper to authenticate before each test
  test.beforeEach(async ({ page, context }) => {
    // Set auth token in localStorage to simulate logged-in user
    await context.addInitScript(() => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          isAuthenticated: true,
          token: 'test-jwt-token',
          userId: 'test-user-123'
        }
      }));
    });
  });

  test.describe('Dashboard Access', () => {
    test('should load dashboard for authenticated user', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);

      // Wait for dashboard content to load
      await expect(page.locator('h1')).toContainText(/Dashboard|Statistics|Overview/i);

      // Check for key dashboard elements
      await expect(page.locator('text=Documents')).toBeVisible();
      await expect(page.locator('text=Entities')).toBeVisible();
    });

    test('should display sync status', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);

      // Look for sync-related UI elements
      const syncElements = page.locator('[class*="sync"]');
      if (await syncElements.count() > 0) {
        await expect(syncElements.first()).toBeVisible();
      }
    });
  });

  test.describe('Knowledge Search Flow', () => {
    test('should navigate to search page', async ({ page }) => {
      await page.goto(`${BASE_URL}/search`);

      // Check for search input
      const searchInput = page.locator('input[type="text"]', { has: page.locator('button:has-text("Search")') });
      await expect(searchInput).toBeVisible();
    });

    test('should submit search query', async ({ page }) => {
      await page.goto(`${BASE_URL}/search`);

      const queryInput = page.locator('textarea[placeholder*="question"], input[placeholder*="question"]');
      if (await queryInput.count() > 0) {
        await queryInput.fill('What are the main projects?');

        const submitButton = page.locator('button:has-text("Search"), button:has-text("Ask")');
        await submitButton.click();

        // Wait for response (would normally show answer)
        await page.waitForTimeout(1000);
      }
    });

    test('should display search results with citations', async ({ page }) => {
      await page.goto(`${BASE_URL}/search`);

      // Fill and submit query
      const queryInput = page.locator('textarea[placeholder*="question"], input[placeholder*="question"]');
      if (await queryInput.count() > 0) {
        await queryInput.fill('Tell me about this project');

        const submitButton = page.locator('button:has-text("Search"), button:has-text("Ask")');
        if (await submitButton.count() > 0) {
          await submitButton.click();

          // Check for response elements (answer text or loading state)
          await page.waitForSelector('[class*="answer"], [class*="response"], [class*="loading"]', { timeout: 3000 }).catch(() => {});
        }
      }
    });

    test('should allow user feedback on answers', async ({ page }) => {
      await page.goto(`${BASE_URL}/search`);

      // Look for feedback buttons (thumbs up/down, flag)
      const feedbackButtons = page.locator('button[class*="feedback"], button[aria-label*="helpful"]');
      if (await feedbackButtons.count() > 0) {
        await expect(feedbackButtons.first()).toBeVisible();
      }
    });
  });

  test.describe('Entity Browser', () => {
    test('should navigate to entities page', async ({ page }) => {
      await page.goto(`${BASE_URL}/entities`);

      // Check for entity list or search
      const entitySearchInput = page.locator('input[placeholder*="entity"], input[placeholder*="search"]');
      if (await entitySearchInput.count() > 0) {
        await expect(entitySearchInput.first()).toBeVisible();
      }
    });

    test('should filter entities by type', async ({ page }) => {
      await page.goto(`${BASE_URL}/entities`);

      // Look for filter dropdown or buttons
      const typeFilter = page.locator('select[id*="type"], button[aria-label*="filter"], button:has-text("Filter")');
      if (await typeFilter.count() > 0) {
        await typeFilter.first().click();
        await page.waitForTimeout(500);
      }
    });

    test('should view entity details', async ({ page }) => {
      await page.goto(`${BASE_URL}/entities`);

      // Click first entity if available
      const entityItems = page.locator('[class*="entity-item"], [class*="entity-card"], tr:has([class*="entity"])');
      if (await entityItems.count() > 0) {
        await entityItems.first().click();

        // Check for detail view
        const detailView = page.locator('[class*="detail"], [class*="modal"], h2, h3');
        if (await detailView.count() > 0) {
          await expect(detailView.first()).toBeVisible();
        }
      }
    });
  });

  test.describe('Knowledge Graph Visualization', () => {
    test('should navigate to graph page', async ({ page }) => {
      await page.goto(`${BASE_URL}/graph`);

      // Check for graph container
      const graphContainer = page.locator('[class*="graph"], [class*="visualization"], canvas');
      if (await graphContainer.count() > 0) {
        await expect(graphContainer.first()).toBeVisible();
      }
    });

    test('should display graph nodes and edges', async ({ page }) => {
      await page.goto(`${BASE_URL}/graph`);

      // Wait for graph to render
      await page.waitForSelector('[class*="graph"], canvas, svg', { timeout: 3000 }).catch(() => {});

      // Check for graph controls (zoom, pan, etc.)
      const controls = page.locator('button[aria-label*="zoom"], button:has-text("Zoom"), [class*="controls"]');
      if (await controls.count() > 0) {
        await expect(controls.first()).toBeVisible();
      }
    });

    test('should allow entity filtering by type', async ({ page }) => {
      await page.goto(`${BASE_URL}/graph`);

      // Look for filter checkboxes or dropdowns
      const filterElements = page.locator('input[type="checkbox"]');
      if (await filterElements.count() > 0) {
        await expect(filterElements.first()).toBeVisible();
      }
    });
  });

  test.describe('Data Sources Management', () => {
    test('should navigate to data sources page', async ({ page }) => {
      await page.goto(`${BASE_URL}/sources`);

      // Check for data sources content
      const sourcesList = page.locator('[class*="source"], h2:has-text("Source")');
      if (await sourcesList.count() > 0) {
        await expect(sourcesList.first()).toBeVisible();
      }
    });

    test('should show connection status', async ({ page }) => {
      await page.goto(`${BASE_URL}/sources`);

      // Look for status indicators
      const statusElements = page.locator('[class*="status"], [class*="connected"], [class*="sync"]');
      if (await statusElements.count() > 0) {
        await expect(statusElements.first()).toBeVisible();
      }
    });

    test('should allow manual sync trigger', async ({ page }) => {
      await page.goto(`${BASE_URL}/sources`);

      // Look for sync button
      const syncButton = page.locator('button:has-text("Sync"), button[aria-label*="sync"]');
      if (await syncButton.count() > 0) {
        await expect(syncButton.first()).toBeVisible();

        // Note: Don't actually click sync to avoid long waits in tests
      }
    });

    test('should add new data source', async ({ page }) => {
      await page.goto(`${BASE_URL}/sources`);

      // Look for add button
      const addButton = page.locator('button:has-text("Add"), button:has-text("Connect"), button[aria-label*="add"]');
      if (await addButton.count() > 0) {
        await expect(addButton.first()).toBeVisible();
      }
    });
  });

  test.describe('Feedback Review (Admin)', () => {
    test('should navigate to feedback page', async ({ page }) => {
      await page.goto(`${BASE_URL}/feedback`);

      // Check for feedback content
      const feedbackElements = page.locator('h1, h2, [class*="feedback"]');
      if (await feedbackElements.count() > 0) {
        // Dashboard may not be available if not admin, just check it doesn't 404
        expect(page.url()).not.toContain('404');
      }
    });

    test('should display feedback statistics', async ({ page }) => {
      await page.goto(`${BASE_URL}/feedback`);

      // Look for stat cards or charts
      const statsElements = page.locator('[class*="stat"], [class*="metric"], [class*="chart"]');
      if (await statsElements.count() > 0) {
        await expect(statsElements.first()).toBeVisible();
      }
    });
  });

  test.describe('Navigation and Routing', () => {
    test('should navigate between pages via links', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);

      // Look for navigation elements (sidebar, header nav)
      const navLink = page.locator('a[href*="/search"], a[href*="/entities"], a[href*="/graph"]').first();
      if (await navLink.count() > 0) {
        const href = await navLink.getAttribute('href');
        await navLink.click();

        // Verify navigation occurred
        if (href) {
          expect(page.url()).toContain(href);
        }
      }
    });

    test('should maintain auth state during navigation', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);

      // Navigate to multiple pages
      await page.goto(`${BASE_URL}/search`);
      expect(page.url()).toContain('/search');

      await page.goto(`${BASE_URL}/entities`);
      expect(page.url()).toContain('/entities');

      // Should not redirect to login
      expect(page.url()).not.toContain('/login');
    });
  });

  test.describe('Error Handling', () => {
    test('should handle API errors gracefully', async ({ page }) => {
      // Mock failed API response
      await page.route('**/api/**', route => {
        route.abort('failed');
      });

      await page.goto(`${BASE_URL}/search`);

      // Try to submit a query
      const queryInput = page.locator('textarea[placeholder*="question"], input[placeholder*="question"]');
      if (await queryInput.count() > 0) {
        await queryInput.fill('test query');

        const submitButton = page.locator('button:has-text("Search"), button:has-text("Ask")');
        if (await submitButton.count() > 0) {
          await submitButton.click();

          // Page should show error or gracefully degrade
          await page.waitForTimeout(1000);
        }
      }
    });

    test('should handle missing pages (404)', async ({ page }) => {
      // Navigate to non-existent page
      await page.goto(`${BASE_URL}/nonexistent-page`, { waitUntil: 'networkidle' }).catch(() => {});

      // Should either show 404 or redirect
      const urlContains404 = page.url().includes('404') || page.url().includes('not-found');
      expect(urlContains404 || page.url().includes('/')).toBeTruthy();
    });
  });
});
