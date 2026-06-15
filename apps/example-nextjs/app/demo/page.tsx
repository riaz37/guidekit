export default function DemoPage() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 16px' }}>
      <h1>GuideKit Cognitive Demo</h1>
      <p>
        This page runs Platform Mode with <code>cognitive=&#123;true&#125;</code> for E2E contract
        tests. Voice is text-only here for stability.
      </p>

      <section data-guidekit-target="overview" id="overview" style={{ marginTop: '32px' }}>
        <h2>Overview</h2>
        <p>Ask the assistant about page sections or request guided navigation.</p>
      </section>

      <section data-guidekit-target="contact" id="contact" style={{ marginTop: '32px' }}>
        <h2>Contact Form</h2>
        <form aria-label="Contact form" style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" placeholder="Your name" />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" placeholder="you@example.com" />
          <label htmlFor="message">Message</label>
          <textarea id="message" name="message" rows={3} />
        </form>
      </section>
    </div>
  );
}
