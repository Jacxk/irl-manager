import type { Metadata } from 'next';
import './globals.css';
import { themeScript } from '@/lib/theme-script';
export const metadata: Metadata = {
  title: 'IRL Manager — Your stream, everywhere',
  description:
    'A control room for your IRL broadcasts. Multi-protocol ingest, automatic fallback scenes, and simultaneous streaming to multiple providers.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
