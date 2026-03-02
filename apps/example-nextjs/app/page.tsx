export default function HomePage() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 16px' }}>
      <h1>GuideKit E2E Test Page</h1>
      <p>This page is used for Playwright end-to-end testing of the GuideKit SDK.</p>

      <section data-guidekit-target="hero" id="hero" style={{ marginTop: '32px' }}>
        <h2>Hero Section</h2>
        <p>Welcome to the GuideKit test application. This section demonstrates the hero area.</p>
      </section>

      <section data-guidekit-target="features" id="features" style={{ marginTop: '32px' }}>
        <h2>Features</h2>
        <ul>
          <li>Voice-powered page guidance</li>
          <li>Intelligent DOM scanning</li>
          <li>Accessibility-first design</li>
        </ul>
      </section>

      <section data-guidekit-target="contact" id="contact" style={{ marginTop: '32px' }}>
        <h2>Contact Form</h2>
        <form
          action="#"
          aria-label="Contact form"
          style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '400px' }}
        >
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" placeholder="Your name" required />

          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" placeholder="you@example.com" required />

          <label htmlFor="message">Message</label>
          <textarea id="message" name="message" placeholder="Your message" rows={4} />

          <button type="submit">Send Message</button>
        </form>
      </section>

      <section data-guidekit-target="pricing" id="pricing" style={{ marginTop: '32px' }}>
        <h2>Pricing</h2>
        <p>Choose a plan that works for you.</p>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px', flex: 1, minWidth: '200px' }}>
            <h3>Free</h3>
            <p>$0/month</p>
          </div>
          <div style={{ border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px', flex: 1, minWidth: '200px' }}>
            <h3>Pro</h3>
            <p>$29/month</p>
          </div>
        </div>
      </section>
    </div>
  );
}
