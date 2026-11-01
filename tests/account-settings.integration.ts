import 'dotenv/config';
import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

// Use only an isolated local test deployment; creates and removes its own account.
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3001';
const db = postgres(process.env.DATABASE_URL!);
const browser = await chromium.launch({ headless: true });
let userId: string | undefined;
try {
  const context = await browser.newContext({ baseURL: base });
  const other = await browser.newContext({ baseURL: base });
  const email = `account-${randomUUID()}@example.com`;
  const password = randomUUID();
  const newPassword = randomUUID();
  const signup = await context.request.post('/api/auth/sign-up/email', {
    data: { name: 'Account test', email, password },
  });
  expect(signup.ok()).toBe(true);
  userId = (await signup.json()).user.id;
  expect(
    (await other.request.post('/api/auth/sign-in/email', { data: { email, password } })).ok(),
  ).toBe(true);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/settings');
  const modal = page.getByRole('dialog');
  const save = page.getByRole('button', { name: 'Save changes', exact: true });
  await expect(save).toHaveCount(0);
  const name = page.getByLabel('Display name', { exact: true });
  await name.fill('Changed name');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(name).toHaveValue('Account test');
  await expect(save).toHaveCount(0);
  await name.fill('Changed name');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(name).toHaveValue('Changed name');
  await save.click();
  await expect(page.getByText('Account settings saved.', { exact: true })).toBeVisible();
  await expect(save).toHaveCount(0);
  await page.reload();
  await expect(name).toHaveValue('Changed name');
  await page.getByLabel('Current password', { exact: true }).fill('incorrect-password');
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await save.click();
  await expect(modal.getByRole('alert')).toHaveText('New passwords do not match.');
  await page.getByLabel('Confirm password', { exact: true }).fill(newPassword);
  await save.click();
  await expect(modal.getByRole('alert')).toContainText(/password/i);
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue(newPassword);
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await save.click();
  await expect(save).toHaveCount(0);
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
  expect(await (await other.request.get('/api/auth/get-session')).json()).toBeNull();
  expect(
    (await other.request.post('/api/auth/sign-in/email', { data: { email, password } })).ok(),
  ).toBe(false);
  expect(
    (
      await other.request.post('/api/auth/sign-in/email', {
        data: { email, password: newPassword },
      })
    ).ok(),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await name.fill('Mobile draft');
  await expect(save).toBeVisible();
  expect(await modal.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(modal).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    'Account settings passed: name persistence, Cancel, discard, confirmation, wrong password, password change, session revocation, new login, mobile layout, no runtime errors.',
  );
} finally {
  await browser.close();
  if (userId) {
    const rows = await db`select "workspaceId" from member where "userId"=${userId}`;
    for (const row of rows) await db`delete from workspace where id=${row.workspaceId}`;
    await db`delete from "user" where id=${userId}`;
  }
  await db.end();
}
