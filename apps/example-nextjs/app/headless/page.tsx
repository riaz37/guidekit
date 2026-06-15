export default function HeadlessPage() {
  return (
    <section style={{ padding: 24, maxWidth: 720 }}>
      <h1>Headless GuideKit</h1>
      <p>
        This route uses <code>headless</code> mode — the stock widget is not mounted.
        The top-left assistant is a custom React UI built with GuideKit hooks.
      </p>
      <p id="headless-demo-content">
        Contract E2E targets this page to verify custom UI messaging without the default FAB.
      </p>
    </section>
  );
}
