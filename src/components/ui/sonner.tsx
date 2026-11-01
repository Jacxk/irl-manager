'use client';

import { Toaster as Sonner } from 'sonner';
import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('irl-theme-change', callback);
  return () => window.removeEventListener('irl-theme-change', callback);
}

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ theme = 'system', ...props }: ToasterProps) => {
  const resolvedTheme = useSyncExternalStore(
    subscribe,
    () => {
      const value = document.documentElement.dataset.theme;
      return value === 'dark' || value === 'light' ? value : theme;
    },
    () => theme,
  );
  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      position="top-right"
      duration={4000}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
