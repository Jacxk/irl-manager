import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { chromium, expect } from '@playwright/test';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3147';
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_admin_verify'));
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const f = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const [original] =
  await sql`select "sceneTitle","sceneSubtitle","sceneColor","graceSeconds" from channel where id=${f.channel.id}`;
const browser = await chromium.launch({ headless: true });
const spaces: string[] = [];
let person: string | undefined;
const addCookies = (cookie: string) =>
  cookie.split('; ').map((v) => {
    const i = v.indexOf('=');
    return { name: v.slice(0, i), value: v.slice(i + 1), url: base };
  });
try {
  await sql`delete from rate_limit`;
  const email = `${randomUUID()}@example.test`,
    name = `Crew ${randomUUID().slice(0, 8)}`;
  const signup = await fetch(base + '/api/auth/sign-up/email', {
    method: 'POST',
    headers: { Origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password: randomUUID() }),
  });
  assert.equal(signup.status, 200);
  person = (await signup.json()).user.id;
  const cookie = signup.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  const targetState = await (
    await fetch(base + '/api/control', { headers: { Cookie: cookie } })
  ).json();
  spaces.push(targetState.workspace.id);
  const owner = await browser.newContext();
  await owner.addCookies(addCookies(f.owner.cookie));
  const page = await owner.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByLabel('Headline', { exact: true }).fill('Discard this scene');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal(
    (await sql`select "sceneTitle" from channel where id=${f.channel.id}`)[0].sceneTitle,
    original.sceneTitle,
  );
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await expect(page.getByLabel('Headline', { exact: true })).toHaveValue(original.sceneTitle);
  await page.getByLabel('Headline', { exact: true }).fill('Browser scene');
  await page.getByLabel('Supporting text', { exact: true }).fill('Browser subtitle');
  await page.getByLabel('Background color', { exact: true }).fill('#224466');
  await page.getByLabel('Auto-end after no input (seconds)', { exact: false }).fill('45');
  await page.getByRole('button', { name: 'Save scene', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await expect(page.getByLabel('Headline', { exact: true })).toHaveValue('Browser scene');
  await expect(page.getByLabel('Background color', { exact: true })).toHaveValue('#224466');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Add teammate', exact: true }).click();
  await page.getByLabel('Teammate’s email', { exact: true }).fill(email);
  await expect(page.locator('select[name=role]')).toHaveAccessibleName('Role');
  await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption('operator');
  await page.getByRole('button', { name: 'Add teammate', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const recipient = await browser.newContext();
  await recipient.addCookies(addCookies(cookie));
  const target = await recipient.newPage();
  target.on('pageerror', (e) => errors.push(e.message));
  await target.goto(base);
  await target.getByRole('button', { name: 'Join workspace', exact: true }).click();
  await expect(target.getByRole('button', { name: 'Join workspace', exact: true })).toHaveCount(0);
  const joined = await (await fetch(base + '/api/control', { headers: { Cookie: cookie } })).json();
  assert.equal(joined.role, 'operator');
  assert.equal(joined.workspace.id, f.workspaces[0]);
  await expect(target.getByRole('button', { name: 'Create channel', exact: true })).toHaveCount(0);
  await recipient.close();
  await page.reload();
  await page.getByRole('button', { name: `Remove ${name}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Remove ${name}`, exact: true })).toHaveCount(0);
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Teammate removed.' }),
  ).toBeVisible();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Teammate removed.' }),
  ).toHaveCount(0, { timeout: 8000 });
  const removed = await (
    await fetch(base + '/api/control', { headers: { Cookie: cookie } })
  ).json();
  spaces.push(removed.workspace.id);
  assert.notEqual(removed.workspace.id, f.workspaces[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    'PASS scene cancel/save/reload and Team invite/accept/operator/remove feedback and access change',
  );
} finally {
  await browser.close();
  await sql`update channel set "sceneTitle"=${original.sceneTitle},"sceneSubtitle"=${original.sceneSubtitle},"sceneColor"=${original.sceneColor},"graceSeconds"=${original.graceSeconds} where id=${f.channel.id}`;
  for (const id of spaces) await sql`delete from workspace where id=${id}`;
  if (person) await sql`delete from "user" where id=${person}`;
  await sql.end();
}
