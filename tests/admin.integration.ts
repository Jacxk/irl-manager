import assert from 'node:assert/strict';
import postgres from 'postgres';
const base = process.env.ADMIN_TEST_URL ?? 'http://localhost:3101';
const databaseUrl = process.env.ADMIN_TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_admin_verify'))
  throw new Error('Use a disposable database ending in _admin_verify.');
const sql = postgres(databaseUrl, { max: 1 });
const suffix = crypto.randomUUID();
const password = 'Testing-private-password-123!';
async function request(path: string, body?: unknown, cookie = '') {
  // Isolated auth-flow tests exceed Better Auth's per-endpoint throttle.
  if (path.startsWith('/api/auth/')) await sql`delete from rate_limit`;
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { origin: base, cookie, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { text };
  }
  return {
    status: r.status,
    data,
    cookie: r.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; '),
  };
}
try {
  const adminEmail = `admin-${suffix}@example.test`,
    userEmail = `user-${suffix}@example.test`;
  const first = await request('/api/auth/sign-up/email', {
    name: 'Admin fixture',
    email: adminEmail,
    password,
    instanceRole: 'admin',
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const adminId = first.data.user.id;
  const [before] = await sql`select "instanceRole" from "user" where id = ${adminId}`;
  assert.equal(before.instanceRole, 'user', 'signup cannot inject admin role');
  await sql`update "user" set "instanceRole" = 'admin' where id = ${adminId}`;
  const a = (await request('/api/auth/sign-in/email', { email: adminEmail, password })).cookie;
  const second = await request('/api/auth/sign-up/email', {
    name: 'User fixture',
    email: userEmail,
    password,
  });
  assert.equal(second.status, 200);
  const userId = second.data.user.id;
  let u = second.cookie;
  assert.equal((await request('/api/admin')).status, 401);
  assert.equal((await request('/api/admin', undefined, u)).status, 403);
  assert.equal((await request('/admin', undefined, u)).status, 307);
  assert.equal((await request('/admin', undefined, a)).status, 200);
  for (const path of ['/admin/appearance', '/admin/users', '/admin/shared-nodes']) {
    assert.equal((await request(path, undefined, a)).status, 200);
    assert.equal((await request(path, undefined, u)).status, 307);
    assert.equal((await request(path)).status, 307);
  }
  assert.equal((await request('/admin/unknown', undefined, a)).status, 404);
  assert.equal(
    (await request('/api/admin', { action: 'role', userId, role: 'admin' }, u)).status,
    403,
  );
  const data = (await request('/api/admin', undefined, a)).data;
  assert.ok(data.fields.length > 10);
  assert.ok(!JSON.stringify(data).includes(password));
  const publicUrl = data.fields.find((f: { key: string }) => f.key === 'publicUrl');
  assert.equal(publicUrl.locked, true);
  assert.equal(
    (
      await request(
        '/api/admin',
        {
          action: 'settings',
          changes: [
            { key: 'publicUrl', value: 'https://example.test', revision: publicUrl.revision },
          ],
        },
        a,
      )
    ).status,
    409,
    'environment locks enforced by API',
  );
  const name = data.fields.find((f: { key: string }) => f.key === 'instanceName');
  const change = {
    action: 'settings',
    changes: [{ key: 'instanceName', value: 'Verified instance', revision: name.revision }],
  };
  assert.equal((await request('/api/admin', change, a)).status, 200);
  assert.equal((await request('/api/admin', change, a)).status, 409, 'stale writes rejected');
  assert.equal(
    (
      await request(
        '/api/admin',
        {
          action: 'settings',
          changes: [{ key: 'instanceName', reset: true, revision: name.revision + 1 }],
        },
        a,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request('/api/admin', undefined, a)).data.fields.find(
      (f: { key: string }) => f.key === 'instanceName',
    ).source,
    'Default',
  );
  const csrf = await fetch(base + '/api/admin', {
    method: 'POST',
    headers: { cookie: a, origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: JSON.stringify(change),
  });
  assert.equal(csrf.status, 403);
  assert.equal(
    (await request('/api/admin', { action: 'role', userId: adminId, role: 'user' }, a)).status,
    409,
  );
  assert.equal(
    (await request('/api/admin', { action: 'status', userId: adminId, active: false }, a)).status,
    400,
  );
  // Shared nodes are available across workspaces, while private nodes stay isolated.
  assert.equal(
    (
      await request(
        '/api/control',
        { action: 'createServer', name: 'Shared fixture', host: 'localhost', region: 'Test' },
        a,
      )
    ).status,
    200,
  );
  const owned = (await request('/api/control', undefined, a)).data.servers[0];
  assert.equal(
    (
      await request(
        '/api/control',
        {
          action: 'createChannel',
          name: 'Forbidden fixture',
          serverId: owned.id,
          protocol: 'rtmp',
        },
        u,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        '/api/admin',
        { action: 'sharedNode', nodeId: owned.id, shared: true, available: true },
        a,
      )
    ).status,
    200,
  );
  assert.ok(
    (await request('/api/control', undefined, u)).data.servers.some(
      (n: { id: string }) => n.id === owned.id,
    ),
  );
  assert.equal(
    (
      await request(
        '/api/control',
        {
          action: 'createChannel',
          name: 'Shared channel fixture',
          serverId: owned.id,
          protocol: 'rtmp',
        },
        u,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        '/api/admin',
        { action: 'sharedNode', nodeId: owned.id, shared: true, available: false },
        a,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        '/api/control',
        {
          action: 'createChannel',
          name: 'Unavailable fixture',
          serverId: owned.id,
          protocol: 'rtmp',
        },
        u,
      )
    ).status,
    404,
  );
  assert.ok(
    (await request('/api/control', undefined, u)).data.servers.some(
      (n: { id: string }) => n.id === owned.id,
    ),
    'existing assignments retain node visibility',
  );
  const policy = (await request('/api/admin', undefined, a)).data.fields.find(
    (f: { key: string }) => f.key === 'allowPersonalNodes',
  );
  assert.equal(
    (
      await request(
        '/api/admin',
        {
          action: 'settings',
          changes: [{ key: policy.key, value: false, revision: policy.revision }],
        },
        a,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        '/api/control',
        { action: 'createServer', name: 'Blocked fixture', host: 'localhost', region: 'Test' },
        u,
      )
    ).status,
    403,
  );
  const registration = (await request('/api/admin', undefined, a)).data.fields.find(
    (f: { key: string }) => f.key === 'registrationEnabled',
  );
  assert.equal(
    (
      await request(
        '/api/admin',
        {
          action: 'settings',
          changes: [{ key: registration.key, value: false, revision: registration.revision }],
        },
        a,
      )
    ).status,
    200,
  );
  assert.notEqual(
    (
      await request('/api/auth/sign-up/email', {
        name: 'Blocked signup',
        email: `blocked-${suffix}@example.test`,
        password,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request('/api/admin', { action: 'status', userId, active: false }, a)).status,
    200,
  );
  assert.notEqual((await request('/api/control', undefined, u)).status, 200);
  assert.notEqual(
    (await request('/api/auth/sign-in/email', { email: userEmail, password })).status,
    200,
  );
  assert.equal(
    (await request('/api/admin', { action: 'status', userId, active: true }, a)).status,
    200,
  );
  u = (await request('/api/auth/sign-in/email', { email: userEmail, password })).cookie;
  const reset = await request('/api/admin', { action: 'resetPassword', userId }, a);
  assert.equal(reset.status, 200);
  const token = new URL(reset.data.resetLink).hash.slice(1);
  const newPassword = password + '-new';
  const resetResult = await request('/api/auth/reset-password', { token, newPassword });
  assert.equal(resetResult.status, 200, JSON.stringify(resetResult.data));
  assert.notEqual(
    (await request('/api/auth/reset-password', { token, newPassword })).status,
    200,
    'single use',
  );
  assert.notEqual(
    (await request('/api/control', undefined, u)).status,
    200,
    'reset revokes sessions',
  );
  assert.notEqual(
    (await request('/api/auth/sign-in/email', { email: userEmail, password })).status,
    200,
  );
  assert.equal(
    (await request('/api/auth/sign-in/email', { email: userEmail, password: newPassword })).status,
    200,
  );
  const expired = await request('/api/admin', { action: 'resetPassword', userId }, a);
  const expiredToken = new URL(expired.data.resetLink).hash.slice(1);
  await sql`update verification set "expiresAt" = now() - interval '1 hour' where identifier = ${`reset-password:${expiredToken}`}`;
  assert.notEqual(
    (await request('/api/auth/reset-password', { token: expiredToken, newPassword })).status,
    200,
  );
  // Promote a second admin, then attempt concurrent demotions. Exactly one can win.
  assert.equal(
    (await request('/api/admin', { action: 'role', userId, role: 'admin' }, a)).status,
    200,
  );
  const b = (await request('/api/auth/sign-in/email', { email: userEmail, password: newPassword }))
    .cookie;
  const attempts = await Promise.all([
    request('/api/admin', { action: 'role', userId: adminId, role: 'user' }, a),
    request('/api/admin', { action: 'role', userId, role: 'user' }, b),
  ]);
  assert.equal(attempts.filter((r) => r.status === 200).length, 1);
  const [{ count }] =
    await sql`select count(*)::int as count from "user" where active and "instanceRole" = 'admin'`;
  assert.equal(count, 1);
  if (process.env.ADMIN_TEST_UI === 'true') {
    const { chromium, expect } = await import('@playwright/test');
    const survivor = await sql`select email from "user" where active and "instanceRole" = 'admin'`;
    const login = await request('/api/auth/sign-in/email', {
      email: survivor[0].email,
      password: survivor[0].email === adminEmail ? password : newPassword,
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addCookies(
        login.cookie.split('; ').map((v) => {
          const index = v.indexOf('=');
          return { name: v.slice(0, index), value: v.slice(index + 1), url: base };
        }),
      );
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base + '/admin?returnTo=' + encodeURIComponent('/?view=nodes'));
      const bar = page.getByRole('region', { name: 'Unsaved settings' });
      const nameInput = page.getByLabel('Instance name', { exact: true });
      await nameInput.waitFor();
      await expect(bar).toHaveCount(0);
      await page.getByRole('link', { name: 'Appearance', exact: true }).click();
      await expect(page).toHaveURL(
        base + '/admin/appearance?returnTo=' + encodeURIComponent('/?view=nodes'),
      );
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Users', exact: true }).click();
      await expect(page).toHaveURL(
        base + '/admin/users?returnTo=' + encodeURIComponent('/?view=nodes'),
      );
      await page.goBack();
      await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
      await page.goForward();
      await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'General', exact: true }).click();
      const originalName = await nameInput.inputValue();
      await nameInput.fill('Draft name');
      await expect(bar).toBeVisible();
      await nameInput.fill(originalName);
      await expect(bar).toHaveCount(0);
      await nameInput.fill('Draft name');
      await page.getByRole('link', { name: 'Appearance', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
      await expect(bar).toContainText('1 unsaved change');
      await page.goBack();
      await expect(nameInput).toHaveValue('Draft name');
      await page.goForward();
      await expect(page.getByLabel('Accent color', { exact: true })).toBeVisible();
      const hex = page.getByLabel('Accent color', { exact: true });
      const picker = page.getByLabel('Accent color picker');
      const originalColor = await hex.inputValue();
      await hex.fill('#123456');
      await expect(picker).toHaveValue('#123456');
      await picker.fill('#abcdef');
      await expect(hex).toHaveValue('#abcdef');
      await page.getByLabel('Default theme').click();
      await page.getByRole('option', { name: 'Light', exact: true }).click();
      await expect(bar).toContainText('3 unsaved changes');
      await page.screenshot({
        path: '/tmp/irl-admin-desktop.png',
        fullPage: true,
        animations: 'disabled',
      });
      await bar.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(bar).toHaveCount(0);
      await expect(hex).toHaveValue(originalColor);
      await page.getByRole('link', { name: 'Access', exact: true }).click();
      const registrationSwitch = page.getByRole('switch', {
        name: 'Allow registration',
        exact: true,
      });
      await registrationSwitch.click();
      await expect(bar).toBeVisible();
      await registrationSwitch.click();
      await expect(bar).toHaveCount(0);
      const restore = page.getByRole('checkbox', { name: 'Restore environment or default value' });
      await restore.check();
      await expect(bar).toBeVisible();
      await restore.uncheck();
      await expect(bar).toHaveCount(0);
      await page.getByRole('link', { name: 'General', exact: true }).click();
      await nameInput.fill('');
      await bar.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.locator('[data-sonner-toast][data-type=error]')).toBeVisible();
      await expect(bar).toBeVisible();
      await nameInput.fill('UI verified');
      await bar.getByRole('button', { name: 'Save changes', exact: true }).click();
      const savedToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Settings saved.' });
      await expect(savedToast).toBeVisible();
      await expect(bar).toHaveCount(0);
      await expect(nameInput).toHaveValue('UI verified');
      await expect(savedToast).toHaveCount(0, { timeout: 7000 });
      await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toHaveCount(0);
      await page.getByRole('link', { name: 'Administration', exact: true }).click();
      const auditTable = page.getByRole('table', { name: 'Recent changes' });
      await expect(auditTable).toBeVisible();
      const tableStyle = await auditTable
        .locator('thead th')
        .first()
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            padding: s.padding,
            fontSize: s.fontSize,
            textTransform: s.textTransform,
            letterSpacing: s.letterSpacing,
          };
        });
      await page.screenshot({
        path: '/tmp/irl-admin-table.png',
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByRole('link', { name: 'General', exact: true }).click();
      await nameInput.fill('Unsaved exit');
      await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(bar).toBeVisible();
      await bar.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(nameInput).toHaveValue('UI verified');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('link', { name: 'Appearance', exact: true }).click();
      await hex.fill('#112233');
      await expect(bar).toBeVisible();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      await page.screenshot({
        path: '/tmp/irl-admin-mobile.png',
        fullPage: true,
        animations: 'disabled',
      });
      await bar.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('link', { name: 'Users', exact: true }).click();
      await page.getByLabel('Search users').fill(survivor[0].email);
      await page.getByRole('button', { name: 'Create password reset link', exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
      await expect(page).toHaveURL(base + '/?view=nodes');
      const nodesTable = page.getByRole('table', { name: 'Media nodes' });
      await expect(nodesTable).toBeVisible();
      const nodeStyle = await nodesTable
        .locator('thead th')
        .first()
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            padding: s.padding,
            fontSize: s.fontSize,
            textTransform: s.textTransform,
            letterSpacing: s.letterSpacing,
          };
        });
      assert.deepEqual(
        tableStyle,
        nodeStyle,
        'audit and Nodes tables share typography and spacing',
      );
      assert.deepEqual(errors, []);
      console.log(
        'Admin UI passed: dirty/revert/cancel/save/error behavior, cross-section drafts, shadcn controls, paired color inputs, mobile sidebar, return navigation, matching tables, and auto-dismissing Sonner feedback.',
      );
    } finally {
      await browser.close();
    }
  }
  console.log(
    'Admin integration passed: role isolation, settings revisions/reset, CSRF, deactivation, reset single use/expiry/session revocation, and concurrent last-admin protection.',
  );
} finally {
  await sql.end();
}
