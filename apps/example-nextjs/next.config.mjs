/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile workspace packages so Next.js can process their TypeScript/ESM
  transpilePackages: ['@guidekit/core', '@guidekit/react', '@guidekit/server'],
  // Disable React Strict Mode to avoid double-mount issues with Shadow DOM
  // (attachShadow can only be called once per element)
  reactStrictMode: false,
};

export default nextConfig;
