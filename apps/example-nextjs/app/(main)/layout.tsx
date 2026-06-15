import type { ReactNode } from 'react';
import { Providers } from '../providers';

export default function MainLayout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
