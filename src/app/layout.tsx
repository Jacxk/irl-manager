import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'IRL Manager — Your stream, everywhere',
  description:
    'A control room for your IRL broadcasts. Multi-protocol ingest, automatic fallback scenes, and simultaneous streaming to multiple providers.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
