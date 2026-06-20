export default function PlainPage() {
  return (
    <main style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 16px' }}>
      <h1>Plain Website Demo</h1>
      <p>No <code>data-guidekit-target</code> annotations — heuristic DOM scan only.</p>

      <section id="intro" aria-labelledby="intro-heading" style={{ marginTop: '24px' }}>
        <h2 id="intro-heading">Introduction</h2>
        <p>
          GuideKit infers sections from headings and landmarks on unannotated pages like this one.
        </p>
      </section>

      <section id="features-plain" style={{ marginTop: '24px' }}>
        <h2>Product Features</h2>
        <ul>
          <li>Runtime DOM grounding</li>
          <li>Incremental page memory</li>
          <li>Safe click boundaries</li>
        </ul>
      </section>

      <section id="account-actions" style={{ marginTop: '24px' }}>
        <h2>Account</h2>
        <button type="button" id="safe-action">
          View profile
        </button>
        <button type="button" id="danger-delete" data-testid="danger-delete">
          Delete account
        </button>
      </section>
    </main>
  );
}
