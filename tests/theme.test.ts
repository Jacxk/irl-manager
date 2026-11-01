import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { themeScript } from '../src/lib/theme-script';

function apply(defaultTheme: string, saved: string | null, systemDark = false) {
  const dataset: Record<string, string> = { themeDefault: defaultTheme };
  runInNewContext(themeScript, {
    document: { documentElement: { dataset } },
    localStorage: { getItem: () => saved },
    window: {
      matchMedia: () => ({ matches: systemDark, addEventListener() {} }),
      addEventListener() {},
      dispatchEvent() {},
    },
    Event,
  });
  return dataset;
}

test('instance theme is the default when no browser preference is saved', () => {
  assert.equal(apply('dark', null).theme, 'dark');
  assert.equal(apply('light', null).theme, 'light');
});
test('saved browser theme overrides the instance default', () => {
  assert.equal(apply('dark', 'light').theme, 'light');
  assert.equal(apply('light', 'dark').theme, 'dark');
});
test('system preference resolves against the device color scheme', () => {
  assert.equal(apply('dark', 'system', false).theme, 'light');
  assert.equal(apply('light', 'system', true).theme, 'dark');
  assert.equal(apply('system', null, true).theme, 'dark');
});
test('invalid saved preferences fall back to the instance default', () => {
  assert.equal(apply('light', 'invalid').theme, 'light');
});
