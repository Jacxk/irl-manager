import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const fixture = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/login');
  await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
  await page.screenshot({
    path: '/tmp/irl-manager-login.png',
    fullPage: true,
    animations: 'disabled',
  });
  await context.addCookies(
    fixture.owner.cookie.split('; ').map((value: string) => {
      const index = value.indexOf('=');
      return { name: value.slice(0, index), value: value.slice(index + 1), url: base };
    }),
  );
  await page.goto(base);
  await page.getByRole('heading', { name: 'Your control room.' }).waitFor();
  await page.getByRole('heading', { name: 'Integration stream', exact: true }).waitFor();
  await page.screenshot({
    path: '/tmp/irl-manager-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Destinations', exact: true }).click();
  await page.getByRole('heading', { name: 'One stream. Every audience.' }).waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({
    path: '/tmp/irl-manager-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  assert.deepEqual(errors, []);
  console.log(
    'UI integration passed: login, authenticated dashboard, mobile navigation, no horizontal overflow or runtime errors.',
  );
} finally {
  await browser.close();
}
