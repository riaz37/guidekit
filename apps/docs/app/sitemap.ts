import type { MetadataRoute } from 'next';
import { BRAND } from '../lib/brand';

const DOC_ROUTES = [
  'getting-started',
  'provider',
  'custom-ui',
  'hooks',
  'voice',
  'i18n',
  'proactive-triggers',
  'platform-mode',
  'privacy',
  'observability',
  'server',
  'compatibility',
  'troubleshooting',
  'error-codes',
  'cli',
  'testing',
  'devtools',
  'vanilla',
  'architecture',
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: BRAND.url,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    ...DOC_ROUTES.map((slug) => ({
      url: `${BRAND.url}/docs/${slug}`,
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: slug === 'getting-started' ? 0.9 : 0.7,
    })),
  ];
}
