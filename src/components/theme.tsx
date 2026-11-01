'use client';

import { useSyncExternalStore } from 'react';

const key = 'irl-manager-theme';
const event = 'irl-theme-change';
type Theme = 'dark' | 'light' | 'system';

function subscribe(callback: () => void) {
  window.addEventListener(event, callback);
  return () => window.removeEventListener(event, callback);
}

export function ThemeSelect() {
  const theme = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.themePreference || 'system',
    () => 'system',
  );
  function change(value: Theme) {
    try {
      localStorage.setItem(key, value);
    } catch {
      document.documentElement.dataset.themePreference = value;
      document.documentElement.dataset.theme =
        value === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : value;
      window.dispatchEvent(new Event(event));
      return;
    }
    window.dispatchEvent(new Event('irl-theme-set'));
  }
  return (
    <label className="block text-xs">
      <span className="mb-2 block text-muted-foreground">Theme</span>
      <select value={theme} onChange={(e) => change(e.target.value as Theme)}>
        <option value="system">System</option>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </label>
  );
}
