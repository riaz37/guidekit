import type { MetadataRoute } from 'next';
import { BRAND } from '../lib/brand';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/docs/'],
      disallow: ['/_next/'],
    },
    sitemap: `${BRAND.url}/sitemap.xml`,
  };
}
