'use client';
import { Toaster as Sonner } from 'sonner';
export function Toaster() {
  return (
    <Sonner
      theme="dark"
      richColors
      closeButton
      position="bottom-right"
      toastOptions={{
        style: {
          background: 'var(--card)',
          color: 'var(--foreground)',
          border: '1px solid var(--border)',
        },
      }}
    />
  );
}
