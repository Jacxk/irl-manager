import 'dotenv/config';
import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

// Run against an isolated local database and app, never a shared deployment.
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3001';
const db = postgres(process.env.DATABASE_URL!);
const browser = await chromium.launch({ headless: true });
let userId: string | undefined;
try {
  const context = await browser.newContext({ baseURL: base });
  const response = await context.request.post('/api/auth/sign-up/email', {
    data: {
      name: 'Theme regression',
      email: `theme-${randomUUID()}@example.com`,
      password: randomUUID(),
    },
  });
  expect(response.ok()).toBe(true);
  userId = (await response.json()).user.id;
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    if (width === 390) await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: 'Open account options' }).click();
    const menu = page.locator('#user-options');
    for (const [label, resolved] of [
      ['Light', 'light'],
      ['Dark', 'dark'],
      ['System', 'dark'],
    ]) {
      await menu.getByTitle(label, { exact: true }).click({ delay: 150 });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('radio', { name: label, exact: true })).toBeChecked();
      await expect(page.locator('html')).toHaveAttribute('data-theme', resolved);
    }
    await menu.getByRole('radio', { name: 'System', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(menu.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Refresh dashboard' }).focus();
    await expect(menu).toHaveCount(0);
    await page.getByRole('button', { name: 'Open account options' }).click();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  }
  expect(errors).toEqual([]);
  console.log(
    'Theme menu passed: mouse/touch targets, keyboard, persistence, desktop/mobile, no runtime errors.',
  );
} finally {
  await browser.close();
  if (userId) {
    const memberships = await db`select "workspaceId" from member where "userId" = ${userId}`;
    for (const row of memberships) await db`delete from workspace where id = ${row.workspaceId}`;
    await db`delete from "user" where id = ${userId}`;
  }
  await db.end();
}
