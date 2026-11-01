import { Toaster } from '@/components/ui/sonner';
import type { Metadata } from 'next';
import { readSettings } from '@/lib/settings';
import { InstanceDisplay } from '@/components/instance-display';
import './globals.css';
import { themeScript } from '@/lib/theme-script';
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
export default async function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const { values: s } = await readSettings();
  return (
    <html
      lang={s.language}
      data-theme={s.theme}
      data-theme-default={s.theme}
      suppressHydrationWarning
      style={{ '--primary': s.accentColor } as React.CSSProperties}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <InstanceDisplay
          defaults={{
            theme: s.theme,
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
          {process.env.NODE_ENV === 'development' && (
            <div
              role="status"
              className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-primary bg-background px-4 py-2 text-center text-xs font-semibold text-primary shadow-lg pointer-events-none"
            >
              Development mode
            </div>
          )}
          {children}
          {modal}
          <Toaster theme={s.theme} />
        </InstanceDisplay>
      </body>
    </html>
  );
}
