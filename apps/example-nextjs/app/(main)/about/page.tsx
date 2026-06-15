export default function AboutPage() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 16px' }}>
      <h1>About GuideKit</h1>
      <p>GuideKit is an AI-powered page guidance SDK for web applications.</p>

      <section data-guidekit-target="mission" id="mission" style={{ marginTop: '32px' }}>
        <h2>Our Mission</h2>
        <p>
          We believe every web application should be easy to navigate and understand.
          GuideKit uses intelligent DOM scanning and large language models to provide
          context-aware assistance to your users.
        </p>
      </section>

      <section data-guidekit-target="team" id="team" style={{ marginTop: '32px' }}>
        <h2>Our Team</h2>
        <p>Built by developers who care about accessibility and user experience.</p>
      </section>
    </div>
  );
}
