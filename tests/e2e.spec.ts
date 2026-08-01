import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

/**
 * End-to-end test of the whole session-based game lifecycle against a hosted
 * Supabase project. Configure `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` in
 * `.env` (apply `supabase/migrations/20260801000001_sessions.sql` first), then
 * run `npm run test:e2e`.
 *
 * NOTE: runs as ONE sequential test covering the requirements in order, since
 * the two players share one realtime session.
 */

const NEW_GAME = 'New game';
const JOIN_GAME = 'Join game';
const WAITING = 'Waiting for opponent…';
const TURN_X = 'Player X’s turn';
const TURN_O = 'Player O’s turn';
const WELCOME = 'Let’s get started!';
const OPPONENT_GONE = 'Opponent disconnected.';

// The `reset_room` RPC wipes every session so each run starts clean
// (Playwright loads `.env` in its config).
function supabaseFromEnv() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set in .env');
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

function scoreOf(page: Page, cardIndex: 0 | 1) {
  return page.locator('.players .player-card').nth(cardIndex).locator('.player-card__score');
}

async function openApp(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.app__title')).toBeVisible();
  return { context, page };
}

async function createGame(page: Page, bestOf?: number): Promise<string> {
  await page.getByRole('button', { name: NEW_GAME }).click();
  if (bestOf) await page.locator('.home__select').selectOption(String(bestOf));
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('.room-code')).toBeVisible({ timeout: 15_000 });
  return (await page.locator('.room-code').innerText()).trim();
}

async function joinGame(page: Page, code: string) {
  await page.getByRole('button', { name: JOIN_GAME }).click();
  await page.getByLabel('Session code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
}

test('full two-player match lifecycle', async ({ browser }) => {
  // --- Creator lands on the home screen and creates a session --------------
  const x = await openApp(browser);
  const pageX = x.page;

  await expect(pageX.getByRole('button', { name: NEW_GAME })).toBeVisible();
  await expect(pageX.getByRole('button', { name: JOIN_GAME })).toBeVisible();

  const code = await createGame(pageX);
  await expect(pageX.getByText(WAITING).first()).toBeVisible();
  await expect(cells(pageX).first()).toBeDisabled();

  // Clicking the room code copies it to the clipboard.
  await x.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await pageX.locator('.room-code').click();
  await expect(pageX.getByText('Copied!')).toBeVisible();
  const clip = await pageX.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(code);

  // --- A wrong code is rejected on the home screen --------------------------
  const bad = await openApp(browser);
  await joinGame(bad.page, 'ZZZZZZ');
  await expect(bad.page.getByText(/Session not found/).first()).toBeVisible({ timeout: 10_000 });
  await bad.context.close();

  // --- The joiner joins with the real code ---------------------------------
  const o = await openApp(browser);
  const pageO = o.page;
  await joinGame(pageO, code);

  // Set 1: creator is X and starts.
  await expect(pageX.getByText(WELCOME).first()).toBeVisible({ timeout: 10_000 });
  await expect(pageO.getByText(WELCOME).first()).toBeVisible({ timeout: 10_000 });
  await expect(pageX.getByText(TURN_X)).toBeVisible();
  await expect(pageX.locator('.player-card').nth(0)).toHaveClass(/player-card--x/);
  await expect(cells(pageX).first()).toBeEnabled();
  await expect(cells(pageO).first()).toBeDisabled();
  // The creator's chosen match length is shown to both players.
  await expect(pageX.getByText('Best of 3').first()).toBeVisible();
  await expect(pageO.getByText('Best of 3').first()).toBeVisible();

  // O trying to move while it is X's turn is rejected (O's board is disabled).
  await cells(pageO).nth(1).click({ force: true });
  await expect(cells(pageO).nth(1)).toHaveText('');
  await expect(pageX.getByText(TURN_X)).toBeVisible();

  // --- Set 1: creator (X) wins on the main diagonal -------------------------
  await cells(pageX).nth(0).click(); // X: top-left
  await expect(pageO.getByText(TURN_O)).toBeVisible();

  await cells(pageO).nth(1).click(); // O: top-middle
  await expect(pageX.getByText(TURN_X)).toBeVisible();

  await cells(pageX).nth(4).click(); // X: center
  await cells(pageO).nth(2).click(); // O: top-right
  await cells(pageX).nth(8).click(); // X: bottom-right -> diagonal win

  await expect(pageX.getByText('Player X wins this set!').first()).toBeVisible();
  await expect(pageO.getByText('Player X wins this set!').first()).toBeVisible();
  await expect(scoreOf(pageX, 0)).toHaveText('1');
  await expect(scoreOf(pageX, 1)).toHaveText('0');

  // --- Set 2: the joiner becomes X and starts -------------------------------
  await pageO.getByRole('button', { name: 'Next Set' }).click();
  await expect(pageX.getByText(TURN_X)).toBeVisible({ timeout: 10_000 });
  // Symbols switched: each player's own card is on the left.
  await expect(pageX.locator('.player-card').nth(0)).toHaveClass(/player-card--o/);
  await expect(pageO.locator('.player-card').nth(0)).toHaveClass(/player-card--x/);
  await expect(cells(pageO).first()).toBeEnabled();
  await expect(cells(pageX).first()).toBeDisabled();

  // Joiner (X) wins on the second column.
  await cells(pageO).nth(1).click(); // X: top-middle
  await cells(pageX).nth(0).click(); // O: top-left
  await cells(pageO).nth(4).click(); // X: center
  await cells(pageX).nth(2).click(); // O: top-right
  await cells(pageO).nth(7).click(); // X: bottom-middle -> column win

  await expect(pageX.getByText('Player X wins this set!').first()).toBeVisible();
  await expect(pageO.getByText('Player X wins this set!').first()).toBeVisible();
  await expect(scoreOf(pageX, 0)).toHaveText('1');
  await expect(scoreOf(pageX, 1)).toHaveText('1');

  // --- Set 3: creator is X again and takes the match 2-1 --------------------
  await pageX.getByRole('button', { name: 'Next Set' }).click();
  await expect(pageX.getByText(TURN_X)).toBeVisible({ timeout: 10_000 });
  await expect(pageX.locator('.player-card').nth(0)).toHaveClass(/player-card--x/);

  await cells(pageX).nth(0).click();
  await cells(pageO).nth(1).click();
  await cells(pageX).nth(4).click();
  await cells(pageO).nth(2).click();
  await cells(pageX).nth(8).click(); // diagonal win again

  await expect(pageX.getByText('You won the match!')).toBeVisible();
  await expect(pageO.getByText('You lost the match!')).toBeVisible();

  // --- Restart Match resets board and scores, keeps players -----------------
  await pageX.getByRole('button', { name: 'Restart Match' }).click();
  await expect(pageX.getByText(TURN_X)).toBeVisible({ timeout: 10_000 });
  await expect(scoreOf(pageX, 0)).toHaveText('0');
  await expect(scoreOf(pageX, 1)).toHaveText('0');
  await expect(cells(pageX).nth(0)).toHaveText('');
  await expect(pageX.getByText(WAITING)).toHaveCount(0);

  // --- One player leaves: game pauses for the survivor ---------------------
  await o.context.close();
  await expect(pageX.getByText(OPPONENT_GONE).first()).toBeVisible({ timeout: 25_000 });
  await expect(cells(pageX).first()).toBeDisabled();

  // --- A replacement joins with the same code and play resumes -------------
  const replacement = await openApp(browser);
  await joinGame(replacement.page, code);
  await expect(pageX.getByText(OPPONENT_GONE)).toHaveCount(0, { timeout: 15_000 });
  await expect(pageX.getByText(TURN_X)).toBeVisible();
  await expect(cells(pageX).first()).toBeEnabled();
  await replacement.context.close();

  // --- Both players leave: the session can be restarted by a new joiner ----
  await x.context.close();
  // Give both seats time to expire before a brand-new visitor joins.
  await new Promise((resolve) => setTimeout(resolve, 14_000));

  const fresh = await openApp(browser);
  await joinGame(fresh.page, code);
  await expect(fresh.page.getByText(WAITING).first()).toBeVisible({ timeout: 25_000 });
  await fresh.context.close();
});

test('creator can choose a best of 1 match', async ({ browser }) => {
  const x = await openApp(browser);
  const code = await createGame(x.page, 1);

  const o = await openApp(browser);
  await joinGame(o.page, code);
  await expect(x.page.getByText('Best of 1').first()).toBeVisible({ timeout: 10_000 });

  // A single set decides everything: no "Next Set", the match is over.
  await cells(x.page).nth(0).click();
  await cells(o.page).nth(1).click();
  await cells(x.page).nth(4).click();
  await cells(o.page).nth(2).click();
  await cells(x.page).nth(8).click();

  await expect(x.page.getByText('You won the match!')).toBeVisible();
  await expect(o.page.getByText('You lost the match!')).toBeVisible();
  await expect(x.page.getByRole('button', { name: 'Next Set' })).toHaveCount(0);

  await x.context.close();
  await o.context.close();
});
