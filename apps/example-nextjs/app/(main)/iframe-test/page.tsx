export default function IframeTestPage() {
  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 16px' }}>
      <h1>Iframe Grounding Demo</h1>
      <p>Same-origin iframe content is readable; cross-origin iframes are listed as limitations.</p>

      <section id="embedded-same-origin" style={{ marginTop: '24px' }}>
        <h2>Same-origin embed</h2>
        <iframe
          title="Same origin panel"
          src="/plain"
          style={{ width: '100%', height: '220px', border: '1px solid #cbd5e1', borderRadius: '8px' }}
        />
      </section>

      <section id="embedded-cross-origin" style={{ marginTop: '24px' }}>
        <h2>Cross-origin embed</h2>
        <iframe
          title="External ads frame"
          src="https://example.com"
          sandbox=""
          style={{ width: '100%', height: '120px', border: '1px solid #cbd5e1', borderRadius: '8px' }}
        />
      </section>
    </main>
  );
}
