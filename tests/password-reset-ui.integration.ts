import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { chromium, expect } from '@playwright/test';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3147';
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_admin_verify'));
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const people: { id: string; cookie: string; email: string; password: string; workspace: string }[] =
  [];
const browser = await chromium.launch({ headless: true });
async function account() {
  await sql`delete from rate_limit`;
  const email = `${randomUUID()}@example.test`,
    password = randomUUID();
  const r = await fetch(base + '/api/auth/sign-up/email', {
    method: 'POST',
    headers: { Origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Reset UI fixture', email, password }),
  });
  assert.equal(r.status, 200);
  const data = await r.json(),
    cookie = r.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
  const state = await (await fetch(base + '/api/control', { headers: { Cookie: cookie } })).json();
  const person = { id: data.user.id, cookie, email, password, workspace: state.workspace.id };
  people.push(person);
  return person;
}
try {
  const admin = await account(),
    target = await account();
  await sql`update "user" set "instanceRole"='admin' where id=${admin.id}`;
  for (const [path, cookie] of [
    ['/api/admin', admin.cookie],
    [`/api/nodes/${randomUUID()}/removal`, target.cookie],
  ]) {
    for (const body of ['{', 'null', '[]', '"invalid"']) {
      const r = await fetch(base + path, {
        method: 'POST',
        headers: { Origin: base, Cookie: cookie, 'content-type': 'application/json' },
        body,
      });
      assert.equal(r.status, 400, 'Malformed authorized command must return 400');
    }
  }
  const reset = await fetch(base + '/api/admin', {
    method: 'POST',
    headers: { Origin: base, Cookie: admin.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'resetPassword', userId: target.id }),
  });
  assert.equal(reset.status, 200);
  const { resetLink } = await reset.json();
  // Before hydration (or without JavaScript), credentials must never become a URL query.
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const loginWithoutJs = await noJs.newPage();
  await loginWithoutJs.goto(base + '/login');
  await expect(loginWithoutJs.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  assert.match(
    (await loginWithoutJs.locator('noscript').textContent()) ?? '',
    /JavaScript is required to sign in/,
  );
  await loginWithoutJs.close();
  const resetWithoutJs = await noJs.newPage();
  await resetWithoutJs.goto(resetLink);
  await expect(resetWithoutJs.getByRole('status')).toContainText('Checking your reset link');
  await expect(resetWithoutJs.locator('input[type="password"]')).toHaveCount(0);
  await resetWithoutJs.close();
  await noJs.close();
  const context = await browser.newContext(),
    page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(resetLink);
  const replacement = randomUUID();
  await page.getByLabel('New password', { exact: true }).fill(replacement);
  await page.getByLabel('Confirm new password', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page).toHaveURL(base + '/login');
  expect(new URL(page.url()).hash).toBe('');
  assert.equal(
    (await fetch(base + '/api/control', { headers: { Cookie: target.cookie } })).status,
    401,
  );
  await sql`delete from rate_limit`;
  await page.getByLabel('Email', { exact: true }).fill(target.email);
  await page.getByLabel('Password', { exact: true }).fill(target.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  assert.equal(new URL(page.url()).search, '');
  await sql`delete from rate_limit`;
  await page.getByLabel('Password', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your control room.' })).toBeVisible();
  await page.goto(resetLink);
  await expect(page.getByRole('alert')).toContainText('This link has expired.');
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    'PASS browser reset, cleared token, success redirect, session revocation, old/new sign-in and single-use link; malformed admin/removal envelopes',
  );
} catch (error) {
  throw new Error(String(error).replace(/#[0-9a-f]{64}/gi, '#[redacted]'));
} finally {
  await browser.close();
  for (const person of people) {
    await sql`delete from workspace where id=${person.workspace}`;
    await sql`delete from "user" where id=${person.id}`;
  }
  await sql.end();
}
