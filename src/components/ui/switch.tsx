'use client';
import * as SwitchPrimitive from '@radix-ui/react-switch';
export function Switch(props: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      {...props}
      className="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-border transition data-[state=checked]:bg-primary disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-primary"
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}
