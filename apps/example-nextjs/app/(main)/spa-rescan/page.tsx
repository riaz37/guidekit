'use client';

import { useEffect, useState } from 'react';
import { useGuideKitCore } from '@guidekit/react';

export default function SpaRescanPage() {
  const core = useGuideKitCore();
  const [variant, setVariant] = useState<'a' | 'b'>('a');

  useEffect(() => {
    if (!core?.isReady || typeof core.rescanPage !== 'function') return;
    core.rescanPage();
  }, [variant, core?.isReady, core]);

  return (
    <main style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 16px' }}>
      <h1>SPA DOM Swap Demo</h1>
      <p>Replace page content without navigation to test rescan + page memory invalidation.</p>

      <button type="button" id="swap-content" onClick={() => setVariant((v) => (v === 'a' ? 'b' : 'a'))}>
        Swap content
      </button>

      <div id="dynamic-root" style={{ marginTop: '24px' }}>
        {variant === 'a' ? (
          <section id="panel-alpha">
            <h2>Panel Alpha</h2>
            <p>Initial content visible after load.</p>
          </section>
        ) : (
          <section id="panel-beta">
            <h2>Panel Beta</h2>
            <p>Replacement content after DOM swap — hash should change on rescan.</p>
          </section>
        )}
      </div>
    </main>
  );
}
