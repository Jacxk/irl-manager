import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3147';
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_admin_verify'));
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const f = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const [person] = await sql`select "instanceRole" from "user" where id=${f.owner.id}`;
const browser = await chromium.launch({ headless: true });
try {
  const guest = await browser.newPage();
  for (const route of ['/login', '/reset-password']) {
    const response = await guest.goto(base + route);
    expect(response?.status()).toBe(200);
    await expect(guest.getByRole('main')).toBeVisible();
    await expect(
      guest.getByLabel(route === '/login' ? 'Email' : 'New password', { exact: true }),
    ).toBeVisible();
  }
  await guest.close();
  await sql`update "user" set "instanceRole"='admin' where id=${f.owner.id}`;
  const context = await browser.newContext();
  await context.addCookies(
    f.owner.cookie.split('; ').map((v: string) => {
      const i = v.indexOf('=');
      return { name: v.slice(0, i), value: v.slice(i + 1), url: base };
    }),
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const routes = [
    '/admin',
    '/admin/access',
    '/admin/appearance',
    '/admin/administration',
    '/admin/users',
    '/admin/shared-nodes',
    '/admin/node-operations',
    '/admin/policies',
    '/admin/announcements',
    '/admin/ui-defaults',
  ];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      const response = await page.goto(base + route);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  expect(errors).toEqual([]);
  console.log(
    'PASS guest auth/reset pages and all routed admin sections on desktop/mobile without overflow or runtime errors',
  );
} finally {
  await browser.close();
  await sql`update "user" set "instanceRole"=${person.instanceRole} where id=${f.owner.id}`;
  await sql.end();
}
