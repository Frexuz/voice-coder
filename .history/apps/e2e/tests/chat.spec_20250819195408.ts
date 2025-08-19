import { test, expect } from '@playwright/test';

// Basic chat flow: type and see user bubble; rely on proxy for assistant
 test('chat input shows user bubble', async ({ page }) => {
  await page.goto('/');

  const input = page.getByPlaceholder(/type a message/i);
  await input.fill('hello');

  await page.getByRole('button', { name: /send/i }).click();

  await expect(page.getByText('hello')).toBeVisible();
});
