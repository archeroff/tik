import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

/**
 * End-to-end test of the whole game lifecycle against a hosted Supabase
 * project. Configure `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`
 * (apply `supabase/migrations/20260801000000_init.sql` first), then run
 * `npm run test:e2e`.
 *
 * NOTE: there is a single shared room, so this file intentionally runs as ONE
 * sequential test covering every requirement in order.
 */

const WAITING = 'Waiting for opponent…';
const TURN_X = 'Player X’s turn';
const TURN_O = 'Player O’s turn';
const WELCOME = 'Let’s get started!';
const SPECTATOR = 'Game already started.';
const OPPONENT_GONE = 'Opponent disconnected.';

// The `reset_room` RPC wipes the shared room to a fresh waiting state so every
// run starts clean (Playwright loads `.env` in its config).
function supabaseFromEnv() {
  const url = process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in .env');
  }
  return createClient(url, publishableKey, { realtime: { transport: WebSocket } });
}

test.beforeEach(async () => {
  const { error } = await supabaseFromEnv().rpc('reset_room');
  if (error) throw new Error(`Failed to reset room: ${error.message}`);
});

function cells(page: Page) {
  return page.locator('.board .cell');
}

function scoreOf(page: Page, symbol: 'X' | 'O') {
  return page.locator(`.player-card--${symbol.toLowerCase()} .player-card__score`);
}

async function openApp(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.app__title')).toBeVisible();
  return { context, page };
}

test('full two-player match lifecycle', async ({ browser }) => {
  // --- First visitor becomes Player X and waits ---------------------------
  const x = await openApp(browser);
  const pageX = x.page;

  await expect(pageX.getByText(WAITING).first()).toBeVisible({ timeout: 15_000 });
  await expect(cells(pageX).first()).toBeDisabled();

  // --- Second visitor becomes Player O and the game starts ----------------
  const o = await openApp(browser);
  const pageO = o.page;

  await expect(pageX.getByText(WELCOME).first()).toBeVisible({ timeout: 10_000 });
  await expect(pageO.getByText(WELCOME).first()).toBeVisible({ timeout: 10_000 });
  await expect(pageX.getByText(TURN_X)).toBeVisible();
  await expect(cells(pageX).first()).toBeEnabled();

  // --- Third visitor is rejected ------------------------------------------
  const spectator = await openApp(browser);
  await expect(spectator.page.getByText(SPECTATOR)).toBeVisible();
  await expect(spectator.page.locator('.board')).toHaveCount(0);
  // The spectator polls for a free seat, so it must be gone before the
  // disconnect step or it would instantly reclaim the empty seat.
  await spectator.context.close();

  // --- Illegal moves are rejected ------------------------------------------
  // O tries to move while it is X's turn (O's board is disabled): nothing happens.
  await cells(pageO).nth(1).click({ force: true });
  await expect(cells(pageO).nth(1)).toHaveText('');
  await expect(pageX.getByText(TURN_X)).toBeVisible();

  // --- Set 1: X wins on the main diagonal ----------------------------------
  await cells(pageX).nth(0).click(); // X: top-left
  await expect(cells(pageO).nth(0)).toHaveText('X');
  await expect(pageO.getByText(TURN_O)).toBeVisible();

  await cells(pageO).nth(1).click(); // O: top-middle
  await expect(pageX.getByText(TURN_X)).toBeVisible();

  await cells(pageX).nth(4).click(); // X: center
  await cells(pageO).nth(2).click(); // O: top-right
  await cells(pageX).nth(8).click(); // X: bottom-right -> diagonal win

  await expect(pageX.getByText('Player X wins this set!').first()).toBeVisible();
  await expect(pageO.getByText('Player X wins this set!').first()).toBeVisible();
  await expect(scoreOf(pageX, 'X')).toHaveText('1');
  await expect(scoreOf(pageO, 'O')).toHaveText('0');

  // Clicking a taken cell does nothing even when the overlay is gone later.
  await expect(cells(pageX).first()).toBeDisabled();

  // --- Next Set keeps scores and resets the board --------------------------
  await pageO.getByRole('button', { name: 'Next Set' }).click();
  await expect(pageX.getByText(TURN_X)).toBeVisible();
  await expect(cells(pageX).nth(0)).toHaveText('');
  await expect(scoreOf(pageX, 'X')).toHaveText('1');
  await expect(scoreOf(pageO, 'O')).toHaveText('0');

  // --- Set 2: O wins on the second column ----------------------------------
  await cells(pageX).nth(2).click(); // X: top-right
  await cells(pageO).nth(1).click(); // O: top-middle
  await cells(pageX).nth(3).click(); // X: middle-left
  await cells(pageO).nth(4).click(); // O: center
  await cells(pageX).nth(5).click(); // X: middle-right
  await cells(pageO).nth(7).click(); // O: bottom-middle -> column win

  await expect(pageO.getByText('Player O wins this set!').first()).toBeVisible();
  await expect(scoreOf(pageX, 'X')).toHaveText('1');
  await expect(scoreOf(pageX, 'O')).toHaveText('1');

  // --- Set 3: X takes the match 2-1 ----------------------------------------
  await pageX.getByRole('button', { name: 'Next Set' }).click();
  await cells(pageX).nth(0).click();
  await cells(pageO).nth(1).click();
  await cells(pageX).nth(4).click();
  await cells(pageO).nth(2).click();
  await cells(pageX).nth(8).click(); // diagonal win again

  await expect(pageX.getByText(/wins the match/).first()).toBeVisible();
  await expect(pageO.getByText(/wins the match/).first()).toBeVisible();

  // --- Restart Match resets board and scores, keeps players ----------------
  await pageX.getByRole('button', { name: 'Restart Match' }).click();
  await expect(pageX.getByText(TURN_X)).toBeVisible();
  await expect(scoreOf(pageX, 'X')).toHaveText('0');
  await expect(scoreOf(pageO, 'O')).toHaveText('0');
  await expect(cells(pageX).nth(0)).toHaveText('');
  // Still connected to the same opponent - no waiting room.
  await expect(pageX.getByText(WAITING)).toHaveCount(0);

  // --- One player leaves: game pauses for the survivor ---------------------
  await o.context.close();
  await expect(pageX.getByText(OPPONENT_GONE).first()).toBeVisible({ timeout: 25_000 });
  await expect(cells(pageX).first()).toBeDisabled();

  // --- A new visitor takes the empty seat and play resumes ----------------
  const replacement = await openApp(browser);
  await expect(pageX.getByText(OPPONENT_GONE)).toHaveCount(0, { timeout: 15_000 });
  await expect(pageX.getByText(TURN_X)).toBeVisible();
  await expect(cells(pageX).first()).toBeEnabled();
  await replacement.context.close();

  // --- Both players leave: the waiting room reopens ------------------------
  await replacement.context.close();
  await x.context.close();
  // Give both seats time to expire before a brand-new visitor arrives.
  await new Promise((resolve) => setTimeout(resolve, 14_000));

  const fresh = await openApp(browser);
  await expect(fresh.page.getByText(WAITING).first()).toBeVisible({ timeout: 25_000 });
  await fresh.context.close();
});
