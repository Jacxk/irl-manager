import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVELOPMENT_USER_ID,
  developmentAccountAllowed,
  validateDevelopmentDatabase,
} from '../src/lib/development';

test('development migration rejects production, missing mode, and nonlocal databases', () => {
  for (const mode of ['production', 'test', undefined]) {
    assert.throws(() => validateDevelopmentDatabase(mode, 'postgres://localhost/irl'));
  }
  for (const url of [undefined, 'postgres://remote/irl_dev', 'postgres://localhost/production']) {
    assert.throws(() => validateDevelopmentDatabase('development', url));
  }
  validateDevelopmentDatabase('development', 'postgres://localhost/irl');
  validateDevelopmentDatabase('development', 'postgres://127.0.0.1/contributor_dev');
});

test('development account cannot authenticate or access resources outside development', () => {
  assert.equal(developmentAccountAllowed(DEVELOPMENT_USER_ID, 'development'), true);
  for (const mode of ['production', 'test', undefined]) {
    assert.equal(developmentAccountAllowed(DEVELOPMENT_USER_ID, mode), false);
  }
  assert.equal(developmentAccountAllowed('regular-user', 'production'), true);
});
