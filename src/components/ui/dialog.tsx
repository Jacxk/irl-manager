'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const returnFocus = React.useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
      <DialogPrimitive.Content
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocus.current;
          if (target?.isConnected && target !== document.body) {
            target.focus({ preventScroll: true });
            if (document.activeElement === target) {
              event.preventDefault();
              return;
            }
          }
          // Polling may remove or disable the opener while this dialog is open.
          const main = document.querySelector<HTMLElement>('main');
          if (main) {
            const temporaryTabIndex = !main.hasAttribute('tabindex');
            if (temporaryTabIndex) main.setAttribute('tabindex', '-1');
            main.focus({ preventScroll: true });
            if (document.activeElement === main) {
              event.preventDefault();
              if (temporaryTabIndex)
                main.addEventListener('blur', () => main.removeAttribute('tabindex'), {
                  once: true,
                });
            } else if (temporaryTabIndex) main.removeAttribute('tabindex');
          }
        }}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-7 shadow-2xl',
          className,
        )}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-5 right-5 rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="Close dialog"
        >
          <X size={18} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
