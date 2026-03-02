import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

export const metadata = {
  title: {
    default: 'GuideKit — AI Guide SDK',
    template: '%s — GuideKit',
  },
  description:
    'Embed an AI voice agent that understands your website and guides users through it.',
}

const navbar = (
  <Navbar
    logo={
      <span style={{ fontWeight: 800, fontSize: 18 }}>
        GuideKit
      </span>
    }
    projectLink="https://github.com/guidekit/guidekit"
  />
)

const footer = (
  <Footer>MIT {new Date().getFullYear()} © GuideKit.</Footer>
)

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/guidekit/guidekit/tree/main/apps/docs"
          footer={footer}
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          editLink="Edit this page on GitHub"
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
