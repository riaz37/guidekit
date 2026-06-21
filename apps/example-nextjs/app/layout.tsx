import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'GuideKit Example App',
  description: 'Reference Next.js integration for the GuideKit AI guidance SDK (demo — not for production).',
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: '/icon',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav aria-label="Main navigation" style={{ padding: '16px', borderBottom: '1px solid #e2e8f0' }}>
          <Link href="/" style={{ marginRight: '16px' }}>Home</Link>
          <Link href="/about" style={{ marginRight: '16px' }}>About</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/headless" style={{ marginLeft: '16px' }}>Headless</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
