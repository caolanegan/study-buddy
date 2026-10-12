// End-to-end smoke test against a running build:  npx vite build && npx vite preview --port 4173
// then: node scripts/e2e.cjs [outdir]
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const assert = require('assert');
const URL = process.env.URL || 'http://localhost:4173/';
const out = process.argv[2] || '.';

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const t0 = new Date('2026-10-12T09:00:00').getTime();
  await page.clock.setFixedTime(t0);
  await page.goto(URL);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/e2e-fresh.png` });
  // first run shows the buddy / room onboarding: skip it
  const skip = page.getByRole('dialog').getByRole('button', { name: /^skip$/i });
  if (await skip.count()) {
    await skip.click();
    await page.waitForTimeout(400);
  }

  // free timer session for 61 minutes → still-studying check
  const free = page.getByRole('button', { name: /free timer/i });
  if (await free.count()) await free.first().click();
  await page.getByRole('button', { name: /start/i }).first().click();
  for (let m = 1; m <= 61; m += 5) {
    await page.clock.setFixedTime(t0 + m * 60_000);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  const body = await page.textContent('body');
  assert(/still studying/i.test(body), 'check-in modal should show');
  await page.screenshot({ path: `${out}/e2e-checkin.png` });
  await page.getByRole('button', { name: /yes/i }).first().click();
  await page.clock.setFixedTime(t0 + 70 * 60_000);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^.?\s*end/i }).first().click();
  await page.waitForTimeout(600);
  const summary = await page.textContent('body');
  assert(/1h 10m|70/.test(summary), 'summary should show 1h 10m');
  await page.screenshot({ path: `${out}/e2e-summary.png` });

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('study-buddy:v1')));
  assert.equal(saved.sessions.length, 1);
  assert.equal(saved.sessions[0].activeMs, 70 * 60_000);
  assert.equal(saved.sessions[0].coins, 128); // 70 min × 100/h × 1.1
  console.log('session saved:', saved.sessions[0].activeMs / 60000, 'min,', saved.sessions[0].coins, 'coins');
  console.log('errors:', errors);
  assert.equal(errors.length, 0);
  await browser.close();
  console.log('E2E OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
