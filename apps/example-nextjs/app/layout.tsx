import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav aria-label="Main navigation" style={{ padding: '16px', borderBottom: '1px solid #e2e8f0' }}>
          <a href="/" style={{ marginRight: '16px' }}>Home</a>
          <a href="/about" style={{ marginRight: '16px' }}>About</a>
          <a href="/demo">Demo</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
