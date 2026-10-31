import * as React from 'react';
import { cn } from '@/lib/utils';
export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-primary placeholder:text-muted-foreground disabled:opacity-40',
        className,
      )}
      {...props}
    />
  );
}
