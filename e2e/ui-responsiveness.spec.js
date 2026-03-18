const { test, expect } = require('@playwright/test');

const LOGIN = {
  email: process.env.SPEAKR_TEST_EMAIL || 'admin@example.com',
  password: process.env.SPEAKR_TEST_PASSWORD || 'changeme',
};

// Increase default timeout for processing-heavy tests
test.setTimeout(120_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect page errors and console errors throughout a test. */
function attachErrorCollectors(page) {
  const errors = { page: [], console: [] };

  page.on('pageerror', (err) => {
    errors.page.push(err.message);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.console.push(msg.text());
    }
  });

  return errors;
}

/** Known benign console messages we should ignore when asserting zero errors. */
const BENIGN_PATTERNS = [
  'favicon.ico',
  'net::ERR_',
  'Failed to load resource',
  'service-worker',
  'passive event listener',
  'play() request was interrupted',
  'Missing translation',
  'Download the Vue Devtools',
];

function isBenign(msg) {
  const lower = msg.toLowerCase();
  return BENIGN_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/** Filter error arrays to only actionable errors. */
function actionableErrors(errors) {
  return {
    page: errors.page.filter((e) => !isBenign(e)),
    console: errors.console.filter((e) => !isBenign(e)),
  };
}

/**
 * Assert no actionable errors were collected.
 * @param {object} errors - collected errors
 * @param {string} label - context label
 * @param {object} opts - options
 * @param {boolean} opts.ignoreNavigator - if true, exclude the known navigator.clipboard bug
 */
function assertNoErrors(errors, label = '', opts = {}) {
  const filtered = actionableErrors(errors);
  let all = [...filtered.page, ...filtered.console];
  if (opts.ignoreNavigator) {
    all = all.filter((e) => !e.includes("reading 'navigator'") && !e.includes('navigator'));
  }
  if (all.length > 0) {
    const prefix = label ? `[${label}] ` : '';
    throw new Error(
      `${prefix}Unexpected errors detected:\n` +
        all.map((e, i) => `  ${i + 1}. ${e}`).join('\n')
    );
  }
}

/** Login and wait for Vue app to be ready. Retries on transient connection errors. */
async function login(page, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto('/login', { timeout: 15_000 });
      await page.fill('input[name="email"]', LOGIN.email);
      await page.fill('input[name="password"]', LOGIN.password);
      await page.click('input[type="submit"]');
      await page.waitForURL('/', { timeout: 15_000 });
      await page.waitForSelector('#app', { timeout: 10_000 });
      // Wait for Vue to mount and loader to disappear
      await page.waitForTimeout(2000);
      await expect(page.locator('#loader')).toHaveCount(0, { timeout: 5000 });
      return; // success
    } catch (err) {
      if (attempt < retries && (err.message.includes('ERR_CONNECTION') || err.message.includes('ERR_SOCKET'))) {
        console.log(`Login attempt ${attempt} failed (${err.message.split('\n')[0]}), retrying in 3s...`);
        await page.waitForTimeout(3000);
      } else {
        throw err;
      }
    }
  }
}

/** Get all recording item locators in the sidebar. */
function recordingItems(page) {
  return page.locator('aside .space-y-1 > div');
}

/** Detect invisible overlays blocking the viewport. */
async function detectBlockingOverlays(page) {
  return await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const blocking = [];

    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (
        (style.position === 'fixed' || style.position === 'absolute') &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none'
      ) {
        const rect = el.getBoundingClientRect();
        if (
          rect.width >= vw * 0.8 &&
          rect.height >= vh * 0.8 &&
          parseFloat(style.opacity) > 0
        ) {
          if (el.id === 'app' || el.tagName === 'BODY' || el.tagName === 'HTML') continue;
          blocking.push({
            tag: el.tagName,
            id: el.id || '',
            className: (el.className || '').toString().substring(0, 120),
            zIndex: style.zIndex,
            opacity: style.opacity,
          });
        }
      }
    }
    return blocking;
  });
}

function expectNoSuspiciousOverlays(blockers) {
  const suspicious = blockers.filter(
    (b) =>
      b.id === 'loader' ||
      b.className.includes('backdrop') ||
      b.className.includes('bg-opacity') ||
      b.className.includes('bg-black')
  );
  expect(suspicious).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('UI Responsiveness -- Comprehensive', () => {

  // === BASIC LOAD TESTS ===

  test('login and initial load produces no errors', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);
    await expect(page).toHaveURL('/');
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#loader')).toHaveCount(0);
    await page.waitForTimeout(1000);
    assertNoErrors(errors, 'initial load');
  });

  test('no blocking overlays after login', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);
    const blockers = await detectBlockingOverlays(page);
    expectNoSuspiciousOverlays(blockers);
    assertNoErrors(errors, 'overlay check');
  });

  // === RECORDING LIST TESTS ===

  test('sidebar recordings are clickable and detail view opens', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    const count = await items.count();
    if (count === 0) {
      const emptyIndicator = page.locator('.fa-microphone-slash');
      await expect(emptyIndicator).toBeVisible({ timeout: 3000 });
      assertNoErrors(errors, 'empty state');
      return;
    }

    const start = Date.now();
    await items.first().click();
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: 10_000 });
    const elapsed = Date.now() - start;
    console.log(`First recording click-to-detail: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(5000);

    // Ignore the known navigator bug here -- tested separately
    assertNoErrors(errors, 'select first recording', { ignoreNavigator: true });
  });

  test('click every recording in list without errors (except known navigator bug)', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    const count = await items.count();
    if (count === 0) {
      console.log('No recordings to iterate.');
      return;
    }

    const max = Math.min(count, 10);
    for (let i = 0; i < max; i++) {
      errors.page.length = 0;
      errors.console.length = 0;

      const item = items.nth(i);
      await item.scrollIntoViewIfNeeded();
      await item.click();
      await page.waitForTimeout(1500);

      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 5000 });
      assertNoErrors(errors, `recording ${i}`, { ignoreNavigator: true });
    }
  });

  // === DETAIL VIEW TAB TESTS ===

  test('detail view tabs (Summary, Notes) are clickable', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    if ((await items.count()) === 0) {
      console.log('No recordings -- skipping tab test.');
      return;
    }

    await items.first().click();
    await page.waitForTimeout(1500);

    const summaryTab = page.locator('button').filter({ hasText: /Summary/i }).first();
    const notesTab = page.locator('button').filter({ hasText: /Notes/i }).first();

    if (await summaryTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await summaryTab.click();
      await page.waitForTimeout(500);
    }

    if (await notesTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await notesTab.click();
      await page.waitForTimeout(500);
    }

    if (await summaryTab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await summaryTab.click();
      await page.waitForTimeout(500);
    }

    assertNoErrors(errors, 'tab switching', { ignoreNavigator: true });
  });

  // === CLIPBOARD / COPY TESTS ===

  test('copy buttons do not crash (clipboard)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    if ((await items.count()) === 0) {
      console.log('No recordings -- skipping copy test.');
      return;
    }

    await items.first().click();
    await page.waitForTimeout(2000);

    // Copy transcription button
    const copyTranscript = page.locator('button.copy-btn').first();
    if (await copyTranscript.isVisible({ timeout: 3000 }).catch(() => false)) {
      await copyTranscript.click();
      await page.waitForTimeout(500);
    }

    // Copy summary button
    const summaryTab = page.locator('button').filter({ hasText: /Summary/i }).first();
    if (await summaryTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await summaryTab.click();
      await page.waitForTimeout(500);

      const copySummary = page.locator('button[title*="Copy"]').first();
      if (await copySummary.isVisible({ timeout: 2000 }).catch(() => false)) {
        await copySummary.click();
        await page.waitForTimeout(500);
      }
    }

    // Source URL copy button
    const copyUrlBtn = page.locator('button[title="Copy URL"]').first();
    if (await copyUrlBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await copyUrlBtn.click();
      await page.waitForTimeout(500);
    }

    assertNoErrors(errors, 'copy buttons', { ignoreNavigator: true });
  });

  // === RAPID CLICK TEST ===

  test('rapid clicking between recordings stays responsive', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    const count = await items.count();
    if (count < 2) {
      console.log('Need at least 2 recordings for rapid click test.');
      return;
    }

    const max = Math.min(count, 5);
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < max; i++) {
        await items.nth(i).click();
        await page.waitForTimeout(200);
      }
    }

    await page.waitForTimeout(2000);

    await items.first().click();
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: 5000 });

    const blockers = await detectBlockingOverlays(page);
    expectNoSuspiciousOverlays(blockers);

    assertNoErrors(errors, 'rapid clicking', { ignoreNavigator: true });
  });

  // === THE KNOWN BUG: navigator.clipboard crash ===

  test('KNOWN BUG: navigator.clipboard error when selecting recordings', async ({ page }) => {
    // This test specifically detects the known navigator.clipboard bug.
    // It should FAIL when the bug is present, proving the test catches it.
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    const count = await items.count();
    if (count === 0) {
      console.log('No recordings -- cannot test navigator bug.');
      return;
    }

    // Click through recordings to trigger the bug
    const max = Math.min(count, 5);
    for (let i = 0; i < max; i++) {
      await items.nth(i).click();
      await page.waitForTimeout(2000);
    }

    // Check specifically for the navigator.clipboard error
    const navigatorErrors = errors.page.filter(
      (e) => e.includes("reading 'navigator'") || e.includes('navigator')
    );

    // This assertion expects zero navigator errors.
    // If the bug is present, this test FAILS -- which is the correct behavior.
    expect(
      navigatorErrors,
      `Found ${navigatorErrors.length} navigator.clipboard errors. ` +
        'This is the known UI freeze bug. Example: ' +
        (navigatorErrors[0] || 'none')
    ).toHaveLength(0);
  });

  test('no navigator.clipboard crash on recordings with source_url', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    const count = await items.count();
    if (count === 0) {
      console.log('No recordings -- skipping clipboard test.');
      return;
    }

    const max = Math.min(count, 5);
    let foundSourceUrl = false;

    for (let i = 0; i < max; i++) {
      errors.page.length = 0;
      errors.console.length = 0;

      await items.nth(i).click();
      await page.waitForTimeout(2000);

      const copyUrlBtn = page.locator('button[title="Copy URL"]');
      if ((await copyUrlBtn.count()) > 0 && (await copyUrlBtn.first().isVisible())) {
        foundSourceUrl = true;
        await copyUrlBtn.first().click();
        await page.waitForTimeout(500);

        const clipErrors = errors.page.filter(
          (e) => e.includes('clipboard') || e.includes('navigator') || e.includes('writeText')
        );
        expect(
          clipErrors,
          'navigator.clipboard crash when clicking Copy URL button'
        ).toHaveLength(0);
      }
    }

    if (!foundSourceUrl) {
      console.log('No recordings with source_url found among first ' + max + '.');
    }
  });

  // === UPLOAD VIEW TESTS ===

  test('upload view loads and URL import input is interactive', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    // Click "New" or "+" button to open upload view
    const newBtn = page.locator('aside button:has(.fa-plus)').first();
    if (await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newBtn.click();
    } else {
      const altNewBtn = page.locator('button').filter({ hasText: /New/i }).first();
      if (await altNewBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await altNewBtn.click();
      }
    }
    await page.waitForTimeout(1000);

    const urlInput = page.locator('input[type="url"]');
    if (await urlInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      await page.waitForTimeout(500);
      await expect(urlInput).toHaveValue('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

      const importBtn = page.locator('button').filter({ hasText: /Import/i }).first();
      await expect(importBtn).toBeEnabled();

      await urlInput.fill('');
    }

    assertNoErrors(errors, 'upload view');
  });

  // === ACTION BUTTON TESTS ===

  test('action buttons in detail header respond without errors', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    if ((await items.count()) === 0) {
      console.log('No recordings -- skipping action button test.');
      return;
    }

    await items.first().click();
    await page.waitForTimeout(2000);

    // Star/highlight toggle
    const starBtn = page.locator('button[title*="Highlight"], button[title*="Remove Highlight"]').first();
    if (await starBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await starBtn.click();
      await page.waitForTimeout(500);
      await starBtn.click();
      await page.waitForTimeout(500);
    }

    // Inbox toggle
    const inboxBtn = page.locator('button[title*="Inbox"], button[title*="Mark as Read"]').first();
    if (await inboxBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await inboxBtn.click();
      await page.waitForTimeout(500);
      await inboxBtn.click();
      await page.waitForTimeout(500);
    }

    assertNoErrors(errors, 'action buttons', { ignoreNavigator: true });
  });

  // === VIEW MODE TOGGLE TEST ===

  test('transcription view mode toggle works', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    if ((await items.count()) === 0) {
      console.log('No recordings -- skipping view mode test.');
      return;
    }

    await items.first().click();
    await page.waitForTimeout(2000);

    const toggleBtns = page.locator('.view-mode-toggle .toggle-button');
    const toggleCount = await toggleBtns.count();

    if (toggleCount >= 2) {
      await toggleBtns.nth(1).click();
      await page.waitForTimeout(500);

      await toggleBtns.nth(0).click();
      await page.waitForTimeout(500);
    }

    assertNoErrors(errors, 'view mode toggle', { ignoreNavigator: true });
  });

  // === OVERLAY DETECTION AFTER NAVIGATION ===

  test('no overlays appear after selecting and deselecting recordings', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    const count = await items.count();
    if (count === 0) {
      console.log('No recordings -- skipping select/deselect test.');
      return;
    }

    await items.first().click();
    await page.waitForTimeout(1500);
    expectNoSuspiciousOverlays(await detectBlockingOverlays(page));

    if (count >= 2) {
      await items.nth(1).click();
      await page.waitForTimeout(1500);
      expectNoSuspiciousOverlays(await detectBlockingOverlays(page));
    }

    await items.first().click();
    await page.waitForTimeout(1500);
    expectNoSuspiciousOverlays(await detectBlockingOverlays(page));

    assertNoErrors(errors, 'select/deselect', { ignoreNavigator: true });
  });

  // === PERFORMANCE TEST ===

  test('click responsiveness stays under 2 seconds', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    const count = await items.count();
    if (count === 0) {
      console.log('No recordings -- skipping performance test.');
      return;
    }

    const timings = [];
    const max = Math.min(count, 5);

    for (let i = 0; i < max; i++) {
      const item = items.nth(i);
      await item.scrollIntoViewIfNeeded();

      const start = Date.now();
      await item.click();
      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 5000 });
      const elapsed = Date.now() - start;
      timings.push(elapsed);
      console.log(`Recording ${i} click-to-response: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(2000);
    }

    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(`Average click-to-response: ${avg.toFixed(0)}ms across ${timings.length} recordings`);

    assertNoErrors(errors, 'performance', { ignoreNavigator: true });
  });

  // === URL IMPORT FLOW ===

  test('URL import flow -- submit and verify processing starts', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const newBtn = page.locator('aside button:has(.fa-plus)').first();
    if (await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newBtn.click();
    } else {
      const altNewBtn = page.locator('button').filter({ hasText: /New/i }).first();
      if (await altNewBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await altNewBtn.click();
      }
    }
    await page.waitForTimeout(1000);

    const urlInput = page.locator('input[type="url"]');
    if (!(await urlInput.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('URL input not visible -- skipping import flow test.');
      return;
    }

    const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    await urlInput.fill(testUrl);

    const importBtn = page.locator('button').filter({ hasText: /Import/i }).first();
    await expect(importBtn).toBeEnabled({ timeout: 2000 });
    await importBtn.click();

    // Handle possible upload confirmation modal
    const confirmBtn = page.locator('button').filter({ hasText: /Confirm|Proceed|Yes|Upload/i }).first();
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await page.waitForTimeout(5000);

    const urlCleared = await urlInput.inputValue().catch(() => '');
    const urlError = page.locator('text=already imported').or(page.locator('text=Duplicate'));
    const errorVisible = await urlError.isVisible().catch(() => false);

    if (urlCleared === '' || errorVisible) {
      console.log('URL import submitted successfully (or duplicate detected).');
    } else {
      const spinner = page.locator('.fa-spinner.fa-spin');
      if (await spinner.isVisible().catch(() => false)) {
        console.log('URL import is downloading...');
        await page.waitForFunction(
          () => !document.querySelector('.fa-spinner.fa-spin'),
          { timeout: 60_000 }
        ).catch(() => {
          console.log('Import download timed out, continuing...');
        });
      }
    }

    assertNoErrors(errors, 'URL import');
  });

  // === POST-PROCESSING FREEZE DETECTION ===

  test('after processing, clicking recording does not freeze UI', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    const count = await items.count();
    if (count === 0) {
      console.log('No recordings -- cannot test post-processing freeze.');
      return;
    }

    const max = Math.min(count, 5);
    for (let i = 0; i < max; i++) {
      errors.page.length = 0;
      errors.console.length = 0;

      const item = items.nth(i);
      await item.scrollIntoViewIfNeeded();
      await item.click();
      await page.waitForTimeout(2000);

      // Verify detail view rendered
      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 5000 });

      // Click Summary tab
      const summaryTab = page.locator('button').filter({ hasText: /Summary/i }).first();
      if (await summaryTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await summaryTab.click();
        await page.waitForTimeout(500);
      }

      // Click Notes tab
      const notesTab = page.locator('button').filter({ hasText: /Notes/i }).first();
      if (await notesTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await notesTab.click();
        await page.waitForTimeout(500);
      }

      // Verify no freeze -- app is still visible and responsive
      expect(await page.locator('#app').isVisible()).toBe(true);

      // No blocking overlays
      expectNoSuspiciousOverlays(await detectBlockingOverlays(page));

      // Click source URL copy if present
      const copyUrlBtn = page.locator('button[title="Copy URL"]');
      if ((await copyUrlBtn.count()) > 0 && (await copyUrlBtn.first().isVisible())) {
        await copyUrlBtn.first().click();
        await page.waitForTimeout(500);
      }

      assertNoErrors(errors, `post-process recording ${i}`, { ignoreNavigator: true });
    }
  });

  // === COLLAPSIBLE SECTIONS ===

  test('processing stats collapsible section works', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const items = recordingItems(page);
    if ((await items.count()) === 0) {
      console.log('No recordings -- skipping processing stats test.');
      return;
    }

    await items.first().click();
    await page.waitForTimeout(2000);

    const statsBtn = page.locator('button').filter({ hasText: /Processing Stats/i }).first();
    if (await statsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await statsBtn.click();
      await page.waitForTimeout(500);

      await statsBtn.click();
      await page.waitForTimeout(500);
    }

    assertNoErrors(errors, 'processing stats', { ignoreNavigator: true });
  });

  // === SIDEBAR FILTER TESTS ===

  test('sidebar filter controls are interactive', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await login(page);

    const filterToggle = page.locator('button').filter({ hasText: /Search recordings|Active filters/i }).first();
    if (await filterToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterToggle.click();
      await page.waitForTimeout(500);

      const starredBtn = page.locator('button').filter({ hasText: /Starred/i }).first();
      if (await starredBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await starredBtn.click();
        await page.waitForTimeout(500);
        await starredBtn.click();
        await page.waitForTimeout(500);
      }

      const inboxBtn = page.locator('button').filter({ hasText: /Inbox/i }).first();
      if (await inboxBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await inboxBtn.click();
        await page.waitForTimeout(500);
        await inboxBtn.click();
        await page.waitForTimeout(500);
      }

      assertNoErrors(errors, 'sidebar filters');
    }
  });
});
