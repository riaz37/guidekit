import { ImageResponse } from 'next/og';
import { BRAND } from '../lib/brand';

export const alt = 'GuideKit — AI Guide SDK';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 80,
          background: `linear-gradient(135deg, ${BRAND.background} 0%, #1e1b4b 50%, ${BRAND.primaryDark} 100%)`,
          color: BRAND.text,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              width: 88,
              height: 88,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.primaryDark})`,
              borderRadius: 20,
              fontSize: 48,
              color: '#ffffff',
            }}
          >
            ✦
          </div>
          <span style={{ fontSize: 64, fontWeight: 800 }}>{BRAND.name}</span>
        </div>
        <p style={{ fontSize: 36, fontWeight: 600, margin: 0, color: BRAND.text }}>
          {BRAND.tagline}
        </p>
        <p
          style={{
            fontSize: 24,
            marginTop: 24,
            maxWidth: 900,
            lineHeight: 1.4,
            color: BRAND.muted,
          }}
        >
          {BRAND.description}
        </p>
      </div>
    ),
    { ...size },
  );
}
