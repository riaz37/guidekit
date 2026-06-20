import type { Metadata } from 'next';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import 'nextra-theme-docs/style.css';
import { BRAND, SEO_KEYWORDS } from '../lib/brand';

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s — ${BRAND.name}`,
  },
  description: BRAND.description,
  keywords: [...SEO_KEYWORDS],
  authors: [{ name: BRAND.name }],
  creator: BRAND.name,
  applicationName: BRAND.name,
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    siteName: BRAND.name,
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
  },
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
  manifest: '/site.webmanifest',
  icons: {
    icon: '/icon',
    apple: '/apple-icon',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: BRAND.name,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  description: BRAND.description,
  url: BRAND.url,
  codeRepository: BRAND.github,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
};

const LogoMark = () => (
  <svg width={28} height={28} viewBox="0 0 512 512" aria-hidden xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gk-nav-bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#4f46e5" />
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="112" fill="url(#gk-nav-bg)" />
    <path
      fill="#ffffff"
      d="M256 96l-59.5 158.1L38.4 224.6l130.2 112.6L122.9 496 256 412.5 389.1 496l-45.7-158.8L473.6 224.6 315.5 254.1 256 96z"
    />
  </svg>
);

const navbar = (
  <Navbar
    logo={
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 18 }}>
        <LogoMark />
        {BRAND.name}
      </span>
    }
    projectLink={BRAND.github}
  />
);

const footer = (
  <Footer>MIT {new Date().getFullYear()} © {BRAND.name}.</Footer>
);

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </Head>
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase={`${BRAND.github}/tree/main/apps/docs`}
          footer={footer}
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          editLink="Edit this page on GitHub"
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
