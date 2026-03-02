import type { ReactNode } from 'react';
import { Providers } from './providers';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <nav aria-label="Main navigation" style={{ padding: '16px', borderBottom: '1px solid #e2e8f0' }}>
            <a href="/" style={{ marginRight: '16px' }}>Home</a>
            <a href="/about" style={{ marginRight: '16px' }}>About</a>
          </nav>
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
