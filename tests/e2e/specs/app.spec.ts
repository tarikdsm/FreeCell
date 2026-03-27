import { expect, type Page, test } from '@playwright/test';

async function waitForEngineReady(page: Page) {
  await expect(page.locator('#board-stage')).toHaveAttribute('data-engine-ready', 'true');
  await expect(page.locator('#board-stage')).toHaveAttribute('data-card-count', '52');
}

test('loads the real engine-backed board and HUD', async ({ page }) => {
  await page.goto('/');
  await waitForEngineReady(page);

  await expect(page.getByRole('heading', { name: /engine-first freecell/i })).toBeVisible();
  await expect(page.locator('#moves')).toHaveText('0');
  await expect(page.locator('#seed')).toHaveText('1');
  await expect(page.locator('#status')).toContainText('Safe auto-play is enabled');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
});

test('new game changes the deterministic seed and restart preserves it', async ({ page }) => {
  await page.goto('/');
  await waitForEngineReady(page);

  const initialSeed = await page.locator('#seed').innerText();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'New Game' }).click();

  await expect(page.locator('#seed')).not.toHaveText(initialSeed);
  const newSeed = await page.locator('#seed').innerText();

  await page.getByRole('button', { name: 'Restart' }).click();

  await expect(page.locator('#seed')).toHaveText(newSeed);
  await expect(page.locator('#moves')).toHaveText('0');
  await expect(page.locator('#status')).toContainText('Current seed restarted');
});

test('auto-play button responds with a deterministic status update', async ({ page }) => {
  await page.goto('/');
  await waitForEngineReady(page);

  await page.getByRole('button', { name: 'Auto-play' }).click();

  await expect(page.locator('#status')).toHaveText(
    /Auto-play sent safe cards to the foundations\.|No safe auto-play move is available right now\./,
  );
  await expect(page.locator('#board-stage')).toHaveAttribute('data-engine-ready', 'true');
});
