import type { Metadata } from 'next';
import { readSettings } from '@/lib/settings';
import { InstanceDisplay } from '@/components/instance-display';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';
export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  const { values: s } = await readSettings();
  return {
    title: s.instanceName,
    description: s.description,
    icons: s.faviconUrl ? { icon: s.faviconUrl } : undefined,
    referrer: 'no-referrer',
  };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { values: s } = await readSettings();
  return (
    <html
      lang={s.language}
      data-theme={s.theme}
      style={{ '--primary': s.accentColor } as React.CSSProperties}
    >
      <body>
        <InstanceDisplay
          defaults={{
            language: s.language,
            timezone: s.timezone,
            hour12: s.hour12,
            instanceName: s.instanceName,
            logoUrl: s.logoUrl,
            minPasswordLength: s.minPasswordLength,
          }}
        >
          {s.banner && (
            <div role="status" className="bg-primary text-primary-foreground p-3 text-center">
              {s.banner}
            </div>
          )}
          {s.maintenanceNotice && (
            <div role="status" className="bg-muted p-3 text-center">
              {s.maintenanceNotice}
            </div>
          )}
          {children}
          <Toaster theme={s.theme} />
        </InstanceDisplay>
      </body>
    </html>
  );
}
