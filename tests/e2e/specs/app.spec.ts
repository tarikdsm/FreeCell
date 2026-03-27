import { expect, type Locator, type Page, test } from '@playwright/test';

async function waitForEngineReady(page: Page) {
  await expect(page.locator('#board-stage')).toHaveAttribute('data-engine-ready', 'true', {
    timeout: 20_000,
  });
  await expect(page.locator('#board-stage')).toHaveAttribute('data-card-count', '52', {
    timeout: 20_000,
  });
  await expect(page.locator('#board-stage')).toHaveAttribute('data-drag-mode', 'stack', {
    timeout: 20_000,
  });
}

async function boardStage(page: Page): Promise<Locator> {
  const stage = page.locator('#board-stage');
  await stage.scrollIntoViewIfNeeded();
  await expect(stage).toBeVisible();
  return stage;
}

async function dragInitialTopCardToFreecell(page: Page) {
  const stage = await boardStage(page);
  const box = await stage.boundingBox();
  const debug = await page.evaluate(() => {
    return (
      window as typeof window & {
        __FREECELL_DEBUG__?: {
          snapshot: {
            tableau: Array<{ cards: Array<{ id: number }> }>;
          };
          renderer: {
            cards: Record<string, { x: number; y: number }>;
            slots: Record<string, { x: number; y: number; width: number; height: number }>;
          };
        };
      }
    ).__FREECELL_DEBUG__;
  });

  expect(box).not.toBeNull();
  expect(debug).toBeTruthy();

  const topCardId = debug?.snapshot.tableau[0]?.cards.at(-1)?.id;
  const card = topCardId !== undefined ? debug?.renderer.cards[topCardId.toString()] : null;
  const freecell = debug?.renderer.slots['freecell:0'];

  expect(card).toBeTruthy();
  expect(freecell).toBeTruthy();

  const startX = (box?.x ?? 0) + (card?.x ?? 0) + (freecell?.width ?? 0) * 0.5;
  const startY = (box?.y ?? 0) + (card?.y ?? 0) + (freecell?.height ?? 0) * 0.6;
  const endX = (box?.x ?? 0) + (freecell?.x ?? 0) + (freecell?.width ?? 0) * 0.5;
  const endY = (box?.y ?? 0) + (freecell?.y ?? 0) + (freecell?.height ?? 0) * 0.5;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 14 });
  await page.mouse.up();
}

test('loads the real engine-backed board and HUD', async ({ page }) => {
  await page.goto('/');
  await waitForEngineReady(page);

  await expect(page.getByRole('heading', { name: /engine-first freecell/i })).toBeVisible();
  await expect(page.locator('#moves')).toHaveText('0');
  await expect(page.locator('#seed')).toHaveText('1');
  await expect(page.locator('#status')).toContainText('Hint search');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Hint' })).toBeEnabled();
});

test('hint button surfaces a solver-backed move suggestion', async ({ page }) => {
  await page.goto('/');
  await waitForEngineReady(page);

  await page.getByRole('button', { name: 'Hint' }).click();

  await expect(page.locator('#board-stage')).not.toHaveAttribute('data-hint-kind', 'none');
  await expect(page.locator('#status')).not.toHaveText('Loading engine...');
});

test('dragging the initial top card to a free cell applies a real move', async ({ page }) => {
  await page.goto('/');
  await waitForEngineReady(page);

  await dragInitialTopCardToFreecell(page);

  await expect(page.locator('#moves')).toHaveText('1');
  await expect(page.locator('#board-stage')).toHaveAttribute('data-drag-active', 'false');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
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
