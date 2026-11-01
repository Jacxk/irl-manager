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
  const context = await browser.newContext(),
    page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(resetLink);
  const replacement = randomUUID();
  await page.getByLabel('New password', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Password updated. You can now sign in.');
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByRole('button', { name: 'Update password', exact: true })).toBeDisabled();
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
  assert.equal(
    (await fetch(base + '/api/control', { headers: { Cookie: target.cookie } })).status,
    401,
  );
  await page.getByRole('link', { name: 'Return to sign in' }).click();
  await sql`delete from rate_limit`;
  await page.getByLabel('Email', { exact: true }).fill(target.email);
  await page.getByLabel('Password', { exact: true }).fill(target.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await sql`delete from rate_limit`;
  await page.getByLabel('Password', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your control room.' })).toBeVisible();
  await page.goto(resetLink);
  await page.getByLabel('New password', { exact: true }).fill(randomUUID());
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/invalid|expired|failed/i);
  expect(errors).toEqual([]);
  console.log(
    'PASS browser reset, cleared token/password, stable success, session revocation, old/new sign-in and single-use link; malformed admin/removal envelopes',
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
