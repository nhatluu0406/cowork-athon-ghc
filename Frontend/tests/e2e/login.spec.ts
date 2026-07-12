import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test('should navigate to login page by default', async ({ page }) => {
    await page.goto('/');
    expect(page.url()).toContain('/login');
  });

  test('should show login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[placeholder*="username"]')).toBeVisible();
    await expect(page.locator('input[placeholder*="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Login")')).toBeVisible();
  });

  test('should require username and password', async ({ page }) => {
    await page.goto('/login');
    const submitButton = page.locator('button:has-text("Login")');

    // Try to submit empty form
    await submitButton.click();

    // Check for required attribute
    const usernameInput = page.locator('input[id="username"]');
    const passwordInput = page.locator('input[id="password"]');

    await expect(usernameInput).toHaveAttribute('required', '');
    await expect(passwordInput).toHaveAttribute('required', '');
  });

  test('should show error on failed login', async ({ page }) => {
    await page.goto('/login');

    const usernameInput = page.locator('input[id="username"]');
    const passwordInput = page.locator('input[id="password"]');

    await usernameInput.fill('testuser');
    await passwordInput.fill('wrongpassword');

    // Mock failed API response
    await page.route('**/api/auth/login', route => {
      route.abort('failed');
    });

    await page.locator('button:has-text("Login")').click();

    // Wait for error message
    await expect(page.locator('text=Login failed')).toBeVisible();
  });
});

test.describe('Protected Routes', () => {
  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/dashboard');
    expect(page.url()).toContain('/login');
  });

  test('should allow authenticated users to dashboard', async ({ page }) => {
    // Set auth token in localStorage
    await page.evaluate(() => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          isAuthenticated: true,
          token: 'test-token',
          userId: 'testuser'
        }
      }));
    });

    await page.goto('/dashboard');
    // Should not be redirected to login
    expect(page.url()).toContain('/dashboard');
  });
});
