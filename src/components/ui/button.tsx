import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85 shadow-sm',
        outline: 'border border-border bg-transparent hover:bg-muted text-foreground',
        ghost: 'hover:bg-muted text-muted-foreground hover:text-foreground',
        destructive: 'bg-destructive/15 text-destructive hover:bg-destructive/25',
      },
      size: { default: 'h-10 px-4 py-2', sm: 'h-8 px-3 text-xs', icon: 'size-9' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
export { Button, buttonVariants };
