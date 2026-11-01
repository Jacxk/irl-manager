import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const draftName = 'Resume draft test ' + randomUUID().slice(0, 8);
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addCookies(
    fixture.owner.cookie.split('; ').map((value: string) => {
      const i = value.indexOf('=');
      return { name: value.slice(0, i), value: value.slice(i + 1), url: base };
    }),
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/?view=nodes');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  const another = page.getByRole('button', { name: 'Set up another node' });
  if (await another.isVisible()) await another.click();
  await page.getByRole('button', { name: /Install on a remote server/ }).click();
  await page.getByLabel('Node name', { exact: true }).fill(draftName);
  await page.getByLabel('Public hostname or IP').fill('203.0.113.8');
  await page.getByLabel('SSH host', { exact: true }).fill('203.0.113.8');
  await page.getByLabel('Authentication', { exact: true }).selectOption('password');
  await page.getByLabel('SSH password').fill('test-draft-password');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: draftName });
  await row.getByRole('button', { name: 'Resume setup', exact: true }).click();
  await expect(page.getByLabel('Node name', { exact: true })).toHaveValue(draftName);
  await expect(page.getByLabel('SSH host', { exact: true })).toHaveValue('203.0.113.8');
  await expect(page.getByPlaceholder('Saved securely')).toHaveValue('');
  await expect(page.getByLabel('Authentication', { exact: true })).toHaveValue('password');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: '/tmp/irl-node-installer-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Draft removed.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    'PASS wizard draft saves on close, survives reload, restores encrypted credential state, supports mobile, and uses Sonner notifications',
  );
} finally {
  await browser.close();
}
