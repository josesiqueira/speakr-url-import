// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:8899';
const EMAIL = process.env.SPEAKR_TEST_EMAIL || 'admin@example.com';
const PASSWORD = process.env.SPEAKR_TEST_PASSWORD || 'changeme';
const SCREENSHOT_DIR = 'e2e/screenshots';

test.setTimeout(300000);

test('Full Navigation Audit', async ({ browser }) => {
  const jsErrors = [];
  const findings = [];
  let context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  let page = await context.newPage();
  let pageCrashed = false;

  function setupPageListeners(p) {
    p.on('pageerror', (error) => {
      jsErrors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        url: p.url(),
      });
      console.error(`[JS ERROR] ${error.message}\n${error.stack}`);
    });
    p.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error(`[CONSOLE ERROR] ${msg.text()}`);
      }
    });
    p.on('crash', () => {
      pageCrashed = true;
      console.error('[CRITICAL] PAGE CRASHED!');
      findings.push('PAGE CRASH: The browser tab crashed after opening a recording detail view.');
    });
  }
  setupPageListeners(page);

  async function freshPage() {
    try { await page.close().catch(() => {}); } catch(e) {}
    try { await context.close().catch(() => {}); } catch(e) {}
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    page = await context.newPage();
    pageCrashed = false;
    setupPageListeners(page);
    // Login
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('networkidle');
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.click('input[type="submit"], button[type="submit"]');
    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await waitForVueApp();
  }

  // ---- Helpers ----
  async function waitForVueApp(timeout = 15000) {
    await page.waitForFunction(
      () => {
        const app = document.getElementById('app');
        return app && app.__vue_app__ && app.style.opacity !== '0';
      },
      { timeout }
    );
  }

  async function checkForBlockingOverlays(stepName) {
    if (pageCrashed) return [];
    try {
      const overlays = await page.evaluate(() => {
        const results = [];
        const allEls = document.querySelectorAll('*');
        for (const el of allEls) {
          const style = window.getComputedStyle(el);
          if (
            (style.position === 'fixed' || style.position === 'absolute') &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            parseFloat(style.opacity) > 0 &&
            el.offsetWidth > 0 &&
            el.offsetHeight > 0
          ) {
            const rect = el.getBoundingClientRect();
            if (
              rect.width > window.innerWidth * 0.8 &&
              rect.height > window.innerHeight * 0.8 &&
              el.id !== 'app'
            ) {
              results.push({
                tag: el.tagName,
                id: el.id,
                classes: el.className?.toString?.()?.substring(0, 120) || '',
                zIndex: style.zIndex,
                size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
                text: el.textContent?.substring(0, 80)?.trim() || '',
              });
            }
          }
        }
        return results;
      });
      if (overlays.length > 0) {
        console.error(`[BLOCKING OVERLAY] at "${stepName}":`, JSON.stringify(overlays, null, 2));
      }
      return overlays;
    } catch(e) {
      console.log(`[WARN] checkForBlockingOverlays failed at "${stepName}": ${e.message.substring(0, 80)}`);
      return [];
    }
  }

  async function dismissAllModals() {
    if (pageCrashed) return;
    try {
      // Try close button
      const closeBtn = page.locator('.fixed.inset-0 button:has(i.fa-times)').first();
      if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(300);
      }
      // Try backdrop click
      const backdrop = page.locator('.fixed.inset-0.bg-black').first();
      if (await backdrop.isVisible({ timeout: 300 }).catch(() => false)) {
        await backdrop.dispatchEvent('click');
        await page.waitForTimeout(300);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      // Force via Vue
      await page.evaluate(() => {
        const app = document.getElementById('app');
        if (app?.__vue_app__) {
          try {
            const proxy = app.__vue_app__._instance?.proxy;
            if (proxy) {
              ['showSharesListModal','showEditModal','showDeleteModal','showEditTagsModal',
               'showReprocessModal','showResetModal','showSpeakerModal','showShareModal',
               'showColorSchemeModal','showUnifiedShareModal','showEditTextModal',
               'showTextEditorModal','showAsrEditorModal','showEditSpeakersModal',
               'showEditParticipantsModal','showDatetimePickerModal','showDuplicatesModal',
               'showGlobalError','showBulkDeleteModal','showBulkTagModal','showBulkReprocessModal',
              ].forEach(flag => { if (proxy[flag] !== undefined) proxy[flag] = false; });
            }
          } catch(e) {}
        }
      });
      await page.waitForTimeout(200);
    } catch(e) {
      console.log(`[WARN] dismissAllModals failed: ${e.message.substring(0, 80)}`);
    }
  }

  async function ss(name) {
    if (pageCrashed) return;
    try {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: false });
    } catch(e) {
      console.log(`[WARN] Screenshot "${name}" failed: ${e.message.substring(0, 60)}`);
    }
  }

  function errCountSince(since) {
    const n = jsErrors.length - since;
    if (n > 0) {
      console.error(`[ERROR COUNT] ${n} new JS error(s)`);
      for (let i = since; i < jsErrors.length; i++) {
        console.error(`  -> ${jsErrors[i].message}`);
      }
    }
    return n;
  }

  function finding(msg) {
    findings.push(msg);
    console.log(`[FINDING] ${msg}`);
  }

  // ======================================================================
  // 1. LOGIN
  // ======================================================================
  console.log('\n=== 1. LOGIN ===');
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await ss('01-login-page');

  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await ss('01b-login-filled');
  await page.click('input[type="submit"], button[type="submit"]');
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await ss('02-after-login');
  console.log(`[OK] Logged in. URL: ${page.url()}`);

  // ======================================================================
  // 2. MAIN PAGE
  // ======================================================================
  console.log('\n=== 2. MAIN PAGE ===');
  await waitForVueApp();
  await ss('03-main-page-loaded');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#app')).toBeVisible();
  await checkForBlockingOverlays('main-page');
  console.log('[OK] Vue app loaded');

  // ======================================================================
  // 3. HEADER - NEW RECORDING BUTTON
  // ======================================================================
  console.log('\n=== 3. HEADER BUTTONS ===');
  let eb = jsErrors.length;

  const newRecBtn = page.locator('header button:has(i.fa-plus)').first();
  await newRecBtn.click();
  await page.waitForTimeout(500);
  await ss('04-upload-view');
  await expect(page.locator('i.fa-cloud-upload-alt').first()).toBeVisible({ timeout: 5000 });
  console.log('[OK] Upload view opened');
  errCountSince(eb);

  // ======================================================================
  // 3b. USER MENU
  // ======================================================================
  console.log('\n=== 3b. USER MENU ===');
  eb = jsErrors.length;
  const userMenuToggle = page.locator('[data-user-menu-toggle]');
  await userMenuToggle.click();
  await page.waitForTimeout(300);
  const dropdown = page.locator('[data-user-menu-dropdown]');
  await expect(dropdown).toBeVisible();
  await ss('05-user-menu-open');
  await expect(dropdown.locator('a[href="/account"]')).toBeVisible();
  await expect(dropdown.locator('a[href="/logout"]')).toBeVisible();
  const hasAdmin = (await dropdown.locator('a[href="/admin"]').count()) > 0;
  console.log(`[INFO] Admin link: ${hasAdmin}`);
  await page.locator('header').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);
  console.log('[OK] User menu tested');

  // ======================================================================
  // 3c. DARK MODE
  // ======================================================================
  console.log('\n=== 3c. DARK MODE ===');
  await userMenuToggle.click();
  await page.waitForTimeout(300);
  const darkModeBtn = page.locator('[data-user-menu-dropdown] button:has(i.fa-moon), [data-user-menu-dropdown] button:has(i.fa-sun)').first();
  if (await darkModeBtn.isVisible()) {
    await darkModeBtn.click();
    await page.waitForTimeout(500);
    await ss('06-dark-mode');
    await userMenuToggle.click();
    await page.waitForTimeout(300);
    const toggleBack = page.locator('[data-user-menu-dropdown] button:has(i.fa-moon), [data-user-menu-dropdown] button:has(i.fa-sun)').first();
    if (await toggleBack.isVisible()) await toggleBack.click();
    console.log('[OK] Dark mode toggled');
  }
  await page.locator('header').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(200);

  // ======================================================================
  // 4. COLOR SCHEME MODAL
  // ======================================================================
  console.log('\n=== 4. COLOR SCHEME MODAL ===');
  eb = jsErrors.length;
  await userMenuToggle.click();
  await page.waitForTimeout(300);
  const colorSchemeBtn = page.locator('[data-user-menu-dropdown] button:has(i.fa-palette)');
  if (await colorSchemeBtn.isVisible()) {
    await colorSchemeBtn.click();
    await page.waitForTimeout(500);
    await ss('07-color-scheme-modal');
    await checkForBlockingOverlays('color-scheme-modal');
    await dismissAllModals();
    console.log('[OK] Color scheme modal opened/closed');
  }
  errCountSince(eb);

  // ======================================================================
  // 5. SHARES LIST MODAL - ESCAPE TEST
  // ======================================================================
  console.log('\n=== 5. SHARES LIST MODAL ===');
  eb = jsErrors.length;
  await userMenuToggle.click();
  await page.waitForTimeout(300);
  const sharesBtn = page.locator('[data-user-menu-dropdown] button:has(i.fa-share-alt)');
  if (await sharesBtn.isVisible()) {
    await sharesBtn.click();
    await page.waitForTimeout(800);
    await ss('08-shares-list-modal');

    // Test Escape
    console.log('[TEST] Pressing Escape on Shares modal...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const stillOpen = await page.locator('.fixed.inset-0.bg-black').first().isVisible().catch(() => false);
    if (stillOpen) {
      finding('BUG: Shares List modal does NOT close on Escape key. The backdrop blocks all pointer events, making the UI completely unresponsive. Template: shares-list-modal.html has @click.self but no @keydown.esc handler.');
      await ss('08b-shares-modal-stuck');
    }
    await dismissAllModals();
  }
  errCountSince(eb);

  // ======================================================================
  // 6. URL IMPORT
  // ======================================================================
  console.log('\n=== 6. URL IMPORT ===');
  eb = jsErrors.length;
  await newRecBtn.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  const urlInput = page.locator('input[type="url"]');
  if (await urlInput.isVisible()) {
    await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.waitForTimeout(300);
    await ss('09-url-import-filled');
    await expect(page.locator('button:has(i.fa-download)')).toBeVisible();
    console.log('[OK] URL import functional');
    await urlInput.fill('');
  }
  errCountSince(eb);

  // ======================================================================
  // 7. SIDEBAR
  // ======================================================================
  console.log('\n=== 7. SIDEBAR ===');
  const sidebar = page.locator('aside.sidebar');
  if (await sidebar.evaluate(el => el.classList.contains('collapsed'))) {
    await page.locator('button:has(i.fa-bars)').first().click();
    await page.waitForTimeout(300);
  }
  await ss('10-sidebar');
  const recItems = page.locator('aside.sidebar .overflow-y-auto .cursor-pointer');
  const recCount = await recItems.count();
  console.log(`[INFO] ${recCount} recording items in sidebar`);

  // ======================================================================
  // 8. RECORDING CLICK - CRITICAL TEST WITH CRASH DETECTION
  // ======================================================================
  console.log('\n=== 8. RECORDING CLICK (CRITICAL) ===');
  eb = jsErrors.length;

  if (recCount > 0) {
    const firstRecTitle = (await recItems.first().textContent().catch(() => '?')).trim().substring(0, 60);
    console.log(`[INFO] Clicking: "${firstRecTitle}"`);
    await ss('11-before-click');

    const clickStart = Date.now();
    await recItems.first().click();

    // Wait for detail view with crash detection
    let detailLoaded = false;
    try {
      await page.waitForFunction(() => {
        const app = document.getElementById('app');
        const proxy = app?.__vue_app__?._instance?.proxy;
        return proxy?.currentView === 'detail' && proxy?.selectedRecording;
      }, { timeout: 10000 });
      detailLoaded = true;
      console.log(`[INFO] Detail view loaded in ${Date.now() - clickStart}ms`);
    } catch(e) {
      if (pageCrashed) {
        finding('CRITICAL: Page CRASHES after clicking a recording to open detail view. The browser tab is killed.');
        console.error('[CRITICAL] Page crashed during detail view load!');
      } else {
        console.error(`[ERROR] Detail view load failed: ${e.message.substring(0, 100)}`);
      }
    }

    if (detailLoaded && !pageCrashed) {
      // Give Vue time to complete all reactive updates
      await page.waitForTimeout(2000);
      await ss('12-after-click');

      // Check if page crashed during reactive update settling
      if (pageCrashed) {
        finding('CRITICAL: Page crashes 2s AFTER detail view initially loads (during Vue reactive settling).');
      }
    }

    if (!pageCrashed && detailLoaded) {
      // Check for overlays
      await checkForBlockingOverlays('after-recording-click');

      // Test responsiveness
      try {
        await page.locator('header h1').click({ timeout: 5000 });
        console.log('[OK] UI responsive');
      } catch(e) {
        finding('CRITICAL: UI is UNRESPONSIVE after clicking a recording detail view.');
        console.error(`[CRITICAL] UI FROZEN: ${e.message.substring(0, 100)}`);
      }

      // Vue state
      const vueState = await page.evaluate(() => {
        const app = document.getElementById('app');
        const proxy = app?.__vue_app__?._instance?.proxy;
        return {
          currentView: proxy?.currentView,
          recordingId: proxy?.selectedRecording?.id,
          title: proxy?.selectedRecording?.title,
          status: proxy?.selectedRecording?.status,
        };
      }).catch(e => ({ error: e.message.substring(0, 80) }));
      console.log('[INFO] Vue state:', JSON.stringify(vueState));
    }

    // If page crashed, report and get a fresh page
    if (pageCrashed) {
      errCountSince(eb);
      console.log('[INFO] Getting fresh page after crash...');
      await freshPage();
    }
  } else {
    console.log('[WARN] No recordings found');
  }

  // ======================================================================
  // 9-14. DETAIL VIEW TESTS (only if page didn't crash and we have recordings)
  // ======================================================================
  if (recCount > 0 && !pageCrashed) {
    // 9. TAB SWITCHING
    console.log('\n=== 9. TAB SWITCHING ===');
    eb = jsErrors.length;
    const summaryTab = page.locator('#rightMainColumn button, main button').filter({ hasText: /^(Summary|Resumo)$/i }).first();
    const notesTab = page.locator('#rightMainColumn button, main button').filter({ hasText: /^(Notes|Notas)$/i }).first();
    if (await summaryTab.isVisible().catch(() => false)) {
      await summaryTab.click();
      await page.waitForTimeout(500);
      await ss('13-summary-tab');
      console.log('[OK] Summary tab');
    }
    if (await notesTab.isVisible().catch(() => false)) {
      await notesTab.click();
      await page.waitForTimeout(500);
      await ss('14-notes-tab');
      console.log('[OK] Notes tab');
    }
    if (await summaryTab.isVisible().catch(() => false)) {
      await summaryTab.click();
      await page.waitForTimeout(300);
    }
    await checkForBlockingOverlays('tabs');
    errCountSince(eb);

    // 10. CHAT
    console.log('\n=== 10. CHAT ===');
    eb = jsErrors.length;
    const chatToggle = page.locator('button:has(i.fa-comments)').first();
    if (await chatToggle.isVisible().catch(() => false)) {
      await chatToggle.click();
      await page.waitForTimeout(500);
      await ss('15-chat');
      console.log('[OK] Chat opened');
      await chatToggle.click();
      await page.waitForTimeout(300);
    }
    errCountSince(eb);

    // 11. ACTION BUTTONS
    console.log('\n=== 11. ACTION BUTTONS ===');
    eb = jsErrors.length;
    for (const [icon, label] of [['fa-star', 'Highlight'], ['fa-inbox', 'Inbox']]) {
      const btn = page.locator(`main button:has(i.${icon})`).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(400);
        await btn.click();
        await page.waitForTimeout(300);
        console.log(`[OK] ${label} toggled`);
      }
    }

    // Tags modal
    const tagsBtn = page.locator('main button:has(i.fa-tags)').first();
    if (await tagsBtn.isVisible().catch(() => false)) {
      await tagsBtn.click();
      await page.waitForTimeout(500);
      await ss('17-tags-modal');
      await checkForBlockingOverlays('tags-modal');
      await dismissAllModals();
      console.log('[OK] Tags modal');
    }

    // Share modal
    const shareBtn = page.locator('main button:has(i.fa-share-alt)').first();
    if (await shareBtn.isVisible().catch(() => false)) {
      await shareBtn.click();
      await page.waitForTimeout(500);
      await ss('18-share-modal');
      await checkForBlockingOverlays('share-modal');
      await dismissAllModals();
      console.log('[OK] Share modal');
    }
    errCountSince(eb);

    // 12. DELETE MODAL
    console.log('\n=== 12. DELETE MODAL ===');
    eb = jsErrors.length;
    const deleteBtn = page.locator('main button:has(i.fa-trash)').first();
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(500);
      await ss('19-delete-modal');
      await checkForBlockingOverlays('delete-modal');
      const cancelBtn = page.locator('.fixed.inset-0 button').filter({ hasText: /Cancel|Cancelar/i }).first();
      if (await cancelBtn.isVisible().catch(() => false)) await cancelBtn.click();
      else await dismissAllModals();
      await page.waitForTimeout(500);
      console.log('[OK] Delete modal');
    }
    errCountSince(eb);

    // 13. REPROCESS MODALS
    console.log('\n=== 13. REPROCESS ===');
    eb = jsErrors.length;
    for (const [icon, label] of [['fa-redo-alt', 'Reprocess Transcription'], ['fa-sync-alt', 'Reprocess Summary']]) {
      const btn = page.locator(`main button:has(i.${icon})`).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(500);
        await ss(`20-${label.replace(/\s/g, '-').toLowerCase()}`);
        await checkForBlockingOverlays(label);
        const cancelBtn = page.locator('.fixed.inset-0 button').filter({ hasText: /Cancel|Cancelar/i }).first();
        if (await cancelBtn.isVisible().catch(() => false)) await cancelBtn.click();
        else await dismissAllModals();
        await page.waitForTimeout(400);
        console.log(`[OK] ${label} modal`);
      }
    }
    errCountSince(eb);

    // 14. COPY BUTTONS
    console.log('\n=== 14. COPY BUTTONS ===');
    eb = jsErrors.length;
    const copyBtns = page.locator('main button:has(i.fa-copy)');
    const copyCount = await copyBtns.count();
    console.log(`[INFO] ${copyCount} copy buttons found`);
    for (let i = 0; i < Math.min(copyCount, 3); i++) {
      try {
        if (await copyBtns.nth(i).isVisible()) {
          await copyBtns.nth(i).click({ timeout: 2000 });
          await page.waitForTimeout(200);
          console.log(`[OK] Copy button ${i+1}`);
        }
      } catch(e) {
        console.log(`[WARN] Copy ${i+1}: ${e.message.substring(0, 60)}`);
      }
    }
    errCountSince(eb);

    // 18. DEEP DETAIL: title edit, date picker, source URL
    console.log('\n=== 18. DEEP DETAIL ===');
    eb = jsErrors.length;
    const titleEl = page.locator('main h1').first();
    if (await titleEl.isVisible()) {
      await titleEl.dblclick();
      await page.waitForTimeout(500);
      await ss('26-title-edit');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      console.log('[OK] Title edit');
    }
    const calIcon = page.locator('main i.fa-calendar').first();
    if (await calIcon.isVisible().catch(() => false)) {
      const dateSpan = calIcon.locator('..').locator('span').first();
      if (await dateSpan.isVisible().catch(() => false)) {
        await dateSpan.click();
        await page.waitForTimeout(500);
        await ss('28-date-picker');
        await dismissAllModals();
        console.log('[OK] Date picker');
      }
    }
    const linkIcon = page.locator('main i.fa-link').first();
    if (await linkIcon.isVisible().catch(() => false)) {
      const copyURLBtn = linkIcon.locator('..').locator('..').locator('button:has(i.fa-copy)').first();
      if (await copyURLBtn.isVisible().catch(() => false)) {
        await copyURLBtn.click({ timeout: 2000 });
        await page.waitForTimeout(200);
        console.log('[OK] Source URL copy');
      }
    }
    errCountSince(eb);
  } else if (recCount > 0 && pageCrashed) {
    finding('SKIPPED: All detail view tests (9-14, 18) skipped because page crashed when opening recording detail.');
  }

  // ======================================================================
  // 15. ACCOUNT PAGE
  // ======================================================================
  console.log('\n=== 15. ACCOUNT PAGE ===');
  eb = jsErrors.length;
  await page.goto(`${BASE}/account`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await ss('23-account-page');
  expect(page.url()).toContain('/account');
  await checkForBlockingOverlays('account-page');
  console.log('[OK] Account page');
  errCountSince(eb);

  // ======================================================================
  // 16. ADMIN PAGE
  // ======================================================================
  console.log('\n=== 16. ADMIN PAGE ===');
  eb = jsErrors.length;
  const adminResp = await page.goto(`${BASE}/admin`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  const adminStatus = adminResp?.status();
  if (adminStatus === 200) {
    await ss('24-admin-page');
    await checkForBlockingOverlays('admin-page');
    console.log('[OK] Admin page');
  } else {
    console.log(`[INFO] Admin page status: ${adminStatus}`);
  }
  errCountSince(eb);

  // ======================================================================
  // 19. FREEZE DETECTION WITH HEARTBEAT
  // ======================================================================
  console.log('\n=== 19. FREEZE DETECTION (HEARTBEAT) ===');
  eb = jsErrors.length;
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await waitForVueApp();
  await page.waitForTimeout(1000);

  const sidebar2 = page.locator('aside.sidebar');
  if (await sidebar2.evaluate(el => el.classList.contains('collapsed'))) {
    await page.locator('button:has(i.fa-bars)').first().click();
    await page.waitForTimeout(500);
  }

  const recs2 = page.locator('aside.sidebar .overflow-y-auto .cursor-pointer');
  const recCount2 = await recs2.count();

  if (recCount2 > 0) {
    // Inject heartbeat
    await page.evaluate(() => {
      window.__heartbeatLog = [];
      window.__heartbeatInterval = setInterval(() => {
        window.__heartbeatLog.push(Date.now());
      }, 50);
    });

    const t0 = Date.now();
    await recs2.first().click();

    // Wait for detail + settling
    try {
      await page.waitForFunction(() => {
        const app = document.getElementById('app');
        const proxy = app?.__vue_app__?._instance?.proxy;
        return proxy?.currentView === 'detail' && proxy?.selectedRecording;
      }, { timeout: 10000 });
    } catch(e) {}

    // Wait for additional settling
    await page.waitForTimeout(5000);

    if (!pageCrashed) {
      const heartbeats = await page.evaluate(() => {
        clearInterval(window.__heartbeatInterval);
        return window.__heartbeatLog;
      });

      let maxGap = 0, gapAt = 0;
      for (let i = 1; i < heartbeats.length; i++) {
        const gap = heartbeats[i] - heartbeats[i-1];
        if (gap > maxGap) { maxGap = gap; gapAt = heartbeats[i] - t0; }
      }

      console.log(`[INFO] Heartbeat: ${heartbeats.length} beats over ${heartbeats.length > 0 ? heartbeats[heartbeats.length-1] - heartbeats[0] : 0}ms, max gap: ${maxGap}ms (at +${gapAt}ms)`);
      if (maxGap > 1000) {
        finding(`CRITICAL: Event loop blocked for ${maxGap}ms after clicking recording (at +${gapAt}ms).`);
      } else if (maxGap > 500) {
        finding(`WARNING: Event loop slow - ${maxGap}ms gap after clicking recording.`);
      } else {
        console.log('[OK] Event loop healthy');
      }

      await checkForBlockingOverlays('freeze-detection');
      await ss('29-freeze-detection');
    } else {
      finding('CRITICAL: Page crashed during freeze detection heartbeat test.');
      await freshPage();
    }
  }
  errCountSince(eb);

  // ======================================================================
  // 20. MODAL ESCAPE-KEY AUDIT
  // ======================================================================
  console.log('\n=== 20. MODAL ESCAPE-KEY AUDIT ===');
  eb = jsErrors.length;

  if (pageCrashed) await freshPage();

  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await waitForVueApp();
  await page.waitForTimeout(1000);

  const modalTests = [
    { name: 'showDeleteModal', label: 'Delete' },
    { name: 'showEditTagsModal', label: 'Edit Tags' },
    { name: 'showReprocessModal', label: 'Reprocess' },
    { name: 'showResetModal', label: 'Reset' },
    { name: 'showColorSchemeModal', label: 'Color Scheme' },
    { name: 'showSharesListModal', label: 'Shares List' },
    { name: 'showUnifiedShareModal', label: 'Unified Share' },
  ];

  for (const mt of modalTests) {
    try {
      await page.evaluate((flag) => {
        const proxy = document.getElementById('app')?.__vue_app__?._instance?.proxy;
        if (proxy?.[flag] !== undefined) proxy[flag] = true;
      }, mt.name);
      await page.waitForTimeout(300);

      const isOpen = await page.locator('.fixed.inset-0').first().isVisible().catch(() => false);
      if (!isOpen) { console.log(`[SKIP] ${mt.label}`); continue; }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      const stillOpen = await page.evaluate((flag) => {
        return document.getElementById('app')?.__vue_app__?._instance?.proxy?.[flag] === true;
      }, mt.name);

      if (stillOpen) {
        finding(`BUG: ${mt.label} modal (${mt.name}) does NOT close on Escape key.`);
        await page.evaluate((flag) => {
          const proxy = document.getElementById('app')?.__vue_app__?._instance?.proxy;
          if (proxy) proxy[flag] = false;
        }, mt.name);
        await page.waitForTimeout(200);
      } else {
        console.log(`[OK] ${mt.label} closes on Escape`);
      }
    } catch(e) {
      console.log(`[SKIP] ${mt.label}: ${e.message.substring(0, 60)}`);
      await dismissAllModals();
    }
  }
  errCountSince(eb);

  // ======================================================================
  // FINAL REPORT
  // ======================================================================
  console.log('\n============================================================');
  console.log('FINAL NAVIGATION AUDIT REPORT');
  console.log('============================================================');
  console.log(`Total JavaScript Errors: ${jsErrors.length}`);
  console.log(`Total Findings: ${findings.length}`);

  if (jsErrors.length > 0) {
    const unique = new Map();
    jsErrors.forEach(e => {
      if (!unique.has(e.message)) unique.set(e.message, { count: 0, first: e });
      unique.get(e.message).count++;
    });
    console.log(`\nUnique JS Errors: ${unique.size}`);
    for (const [msg, d] of unique) {
      console.log(`  [${d.count}x] ${msg}`);
      console.log(`    at: ${d.first.url}`);
      console.log(`    stack: ${d.first.stack?.substring(0, 300)}`);
    }
  }

  if (findings.length > 0) {
    console.log('\n--- FINDINGS ---');
    findings.forEach((f, i) => console.log(`  ${i+1}. ${f}`));
  }
  console.log('============================================================');

  await context.close();
});
