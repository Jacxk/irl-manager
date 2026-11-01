import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3147';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.addCookies(
    fixture.owner.cookie.split('; ').map((v: string) => {
      const i = v.indexOf('=');
      return { name: v.slice(0, i), value: v.slice(i + 1), url: base };
    }),
  );
  const page = await context.newPage();
  let failing = false;
  let commandFails = false;
  let channelState: 'normal' | 'running' | 'removed' = 'normal';
  await page.route('**/api/control', async (route) => {
    if (route.request().method() === 'POST' && commandFails)
      return route.fulfill({ status: 409, json: { error: 'Action needs attention' } });
    if (route.request().method() === 'GET' && failing)
      return route.fulfill({ status: 503, json: { error: 'Temporary control outage' } });
    if (route.request().method() === 'GET' && channelState !== 'normal') {
      const response = await route.fetch();
      const data = await response.json();
      data.channels =
        channelState === 'removed'
          ? []
          : data.channels.map((c: Record<string, unknown>) => ({
              ...c,
              desired: 'running',
              state: 'live',
            }));
      return route.fulfill({ response, json: data });
    }
    return route.continue();
  });
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Your control room.' })).toBeVisible();
  failing = true;
  await expect(page.getByRole('alert').filter({ hasText: 'Temporary control outage' })).toBeVisible(
    { timeout: 10000 },
  );
  failing = false;
  await page.waitForResponse(
    (r) => r.url().endsWith('/api/control') && r.request().method() === 'GET' && r.status() === 200,
  );
  await expect(page.getByRole('alert').filter({ hasText: 'Temporary control outage' })).toHaveCount(
    0,
  );
  commandFails = true;
  await page.getByRole('button', { name: 'Connection details', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Action needs attention' })).toBeVisible();
  await page.waitForResponse(
    (r) => r.url().endsWith('/api/control') && r.request().method() === 'GET' && r.status() === 200,
  );
  await expect(page.getByRole('alert').filter({ hasText: 'Action needs attention' })).toBeVisible();
  commandFails = false;
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  const trigger = page.getByRole('button', { name: 'Edit scene', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const state of ['running', 'removed'] as const) {
    channelState = 'normal';
    await page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/control') && r.request().method() === 'GET' && r.status() === 200,
    );
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    channelState = state;
    if (state === 'running')
      await expect(
        page.getByRole('button', { name: 'Edit scene', exact: true, includeHidden: true }),
      ).toBeDisabled({ timeout: 10000 });
    else
      await expect(
        page.getByRole('button', { name: 'Edit scene', exact: true, includeHidden: true }),
      ).toHaveCount(0, { timeout: 10000 });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('main')).toBeFocused();
  }
  console.log('PASS polling recovery, persistent action errors, keyboard trap and focus return');
} finally {
  await browser.close();
}
