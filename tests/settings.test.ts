import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSetting } from '../src/lib/settings-registry';
test('settings use saved overrides unless the supplied environment value is locked', () => {
  assert.equal(resolveSetting('instanceName', undefined, {}).value, 'IRL Manager');
  assert.equal(resolveSetting('instanceName', undefined, { INSTANCE_NAME: 'Env' }).value, 'Env');
  assert.equal(resolveSetting('instanceName', 'Saved', { INSTANCE_NAME: 'Env' }).value, 'Saved');
  const result = resolveSetting('instanceName', 'Saved', {
    INSTANCE_NAME: 'Env',
    LOCK_BY_ENVIRONMENT: 'true',
  });
  assert.equal(result.value, 'Env');
  assert.equal(result.locked, true);
  assert.equal(
    resolveSetting('instanceName', 'Saved', { LOCK_BY_ENVIRONMENT: 'true' }).locked,
    false,
  );
});
test('environment false and zero are supplied values and invalid settings fail closed', () => {
  assert.equal(
    resolveSetting('registrationEnabled', true, {
      REGISTRATION_ENABLED: 'false',
      LOCK_BY_ENVIRONMENT: 'true',
    }).value,
    false,
  );
  assert.equal(
    resolveSetting('maxNodesPerWorkspace', 5, {
      MAX_NODES_PER_WORKSPACE: '0',
      LOCK_BY_ENVIRONMENT: 'true',
    }).value,
    0,
  );
  assert.throws(() =>
    resolveSetting('registrationEnabled', undefined, { REGISTRATION_ENABLED: 'yes' }),
  );
  assert.throws(() => resolveSetting('sessionDays', undefined, { SESSION_DAYS: '' }));
  assert.throws(() =>
    resolveSetting('publicUrl', undefined, { BETTER_AUTH_URL: 'javascript:alert(1)' }),
  );
});
