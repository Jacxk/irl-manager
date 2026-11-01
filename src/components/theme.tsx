'use client';

import { useId, useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useDisplayDefaults } from './instance-display';

const key = 'irl-manager-theme';
const event = 'irl-theme-change';
type Theme = 'dark' | 'light' | 'system';

function subscribe(callback: () => void) {
  window.addEventListener(event, callback);
  return () => window.removeEventListener(event, callback);
}

export function ThemeSelect() {
  const name = useId();
  const { theme: defaultTheme } = useDisplayDefaults();
  const theme = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.themePreference || defaultTheme,
    () => defaultTheme,
  );
  function change(value: Theme) {
    try {
      localStorage.setItem(key, value);
    } catch {
      document.documentElement.setAttribute('data-theme-preference', value);
      document.documentElement.setAttribute(
        'data-theme',
        value === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : value,
      );
      window.dispatchEvent(new Event(event));
      return;
    }
    window.dispatchEvent(new Event('irl-theme-set'));
  }
  return (
    <fieldset className="min-w-0 text-xs">
      <legend className="sr-only">Theme</legend>
      <div className="flex items-center justify-between gap-2">
        <span aria-hidden="true">Theme</span>
        <div className="inline-flex shrink-0 gap-0.5 rounded-md border border-border bg-muted p-0.5">
          {(
            [
              { value: 'light', label: 'Light', Icon: Sun },
              { value: 'system', label: 'System', Icon: Monitor },
              { value: 'dark', label: 'Dark', Icon: Moon },
            ] as const
          ).map(({ value, label, Icon }) => (
            <label key={value} className="relative cursor-pointer" title={label}>
              <input
                type="radio"
                name={name}
                value={value}
                checked={theme === value}
                onChange={() => change(value)}
                className="peer sr-only"
              />
              <span className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground peer-checked:bg-card peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">
                <Icon size={14} aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
