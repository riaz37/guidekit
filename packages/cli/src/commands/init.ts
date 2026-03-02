// ---------------------------------------------------------------------------
// guidekit init — Scaffold GuideKit configuration in a project
// ---------------------------------------------------------------------------

import * as path from 'node:path';
import {
  c,
  log,
  success,
  warn,
  info,
  heading,
  confirm,
  select,
  fileExists,
  readFile,
  writeFile,
  findProjectRoot,
  detectFramework,
} from '../utils.js';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function tokenEndpointTemplate(framework: string): string {
  if (framework === 'nextjs-app') {
    return `// app/api/guidekit/token/route.ts
import { createSessionToken } from '@guidekit/server';

export async function POST() {
  const token = await createSessionToken({
    signingSecret: process.env.GUIDEKIT_SECRET!,
    llmApiKey: process.env.LLM_API_KEY!,
    sttApiKey: process.env.STT_API_KEY,
    ttsApiKey: process.env.TTS_API_KEY,
    expiresIn: '15m',
  });

  return Response.json(token);
}
`;
  }

  if (framework === 'nextjs-pages') {
    return `// pages/api/guidekit/token.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createSessionToken } from '@guidekit/server';

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse,
) {
  if (_req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = await createSessionToken({
    signingSecret: process.env.GUIDEKIT_SECRET!,
    llmApiKey: process.env.LLM_API_KEY!,
    sttApiKey: process.env.STT_API_KEY,
    ttsApiKey: process.env.TTS_API_KEY,
    expiresIn: '15m',
  });

  return res.json(token);
}
`;
  }

  // Generic Express-style
  return `// server/guidekit-token.ts
import { createSessionToken } from '@guidekit/server';

export async function handleTokenRequest(req: any, res: any) {
  const token = await createSessionToken({
    signingSecret: process.env.GUIDEKIT_SECRET!,
    llmApiKey: process.env.LLM_API_KEY!,
    sttApiKey: process.env.STT_API_KEY,
    ttsApiKey: process.env.TTS_API_KEY,
    expiresIn: '15m',
  });

  res.json(token);
}
`;
}

function providerTemplate(framework: string): string {
  if (framework === 'nextjs-app') {
    return `// app/providers.tsx
'use client';

import { GuideKitProvider } from '@guidekit/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GuideKitProvider
      tokenEndpoint="/api/guidekit/token"
      agent={{
        name: 'Guide',
        greeting: 'Hi! How can I help you today?',
      }}
      options={{
        mode: 'text',
        debug: process.env.NODE_ENV === 'development',
      }}
    >
      {children}
    </GuideKitProvider>
  );
}
`;
  }

  return `// Add GuideKitProvider to your app root:
import { GuideKitProvider } from '@guidekit/react';

function App({ children }) {
  return (
    <GuideKitProvider
      tokenEndpoint="/api/guidekit/token"
      agent={{
        name: 'Guide',
        greeting: 'Hi! How can I help you today?',
      }}
      options={{
        mode: 'text',
        debug: process.env.NODE_ENV === 'development',
      }}
    >
      {children}
    </GuideKitProvider>
  );
}
`;
}

function envTemplate(): string {
  return `# GuideKit SDK Configuration
# Generate a signing secret: npx guidekit generate-secret
GUIDEKIT_SECRET=

# LLM Provider (required)
LLM_API_KEY=

# Voice Providers (optional — for voice mode)
STT_API_KEY=
TTS_API_KEY=
`;
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

function getTokenEndpointPath(root: string, framework: string): string {
  if (framework === 'nextjs-app') {
    // Check src/app vs app
    if (fileExists(path.join(root, 'src', 'app'))) {
      return path.join(root, 'src', 'app', 'api', 'guidekit', 'token', 'route.ts');
    }
    return path.join(root, 'app', 'api', 'guidekit', 'token', 'route.ts');
  }
  if (framework === 'nextjs-pages') {
    if (fileExists(path.join(root, 'src', 'pages'))) {
      return path.join(root, 'src', 'pages', 'api', 'guidekit', 'token.ts');
    }
    return path.join(root, 'pages', 'api', 'guidekit', 'token.ts');
  }
  return path.join(root, 'server', 'guidekit-token.ts');
}

function getProviderPath(root: string, framework: string): string {
  if (framework === 'nextjs-app') {
    if (fileExists(path.join(root, 'src', 'app'))) {
      return path.join(root, 'src', 'app', 'providers.tsx');
    }
    return path.join(root, 'app', 'providers.tsx');
  }
  return '';  // No file created for other frameworks — just show instructions
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runInit(): Promise<void> {
  heading('GuideKit — Project Setup');

  const root = findProjectRoot();
  const framework = detectFramework(root);

  info(`Project root: ${c.dim}${root}${c.reset}`);
  info(`Detected framework: ${c.bold}${framework}${c.reset}`);
  log('');

  // Step 1: Check if packages are installed
  const pkgPath = path.join(root, 'package.json');
  if (fileExists(pkgPath)) {
    const pkg = JSON.parse(readFile(pkgPath));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    const missing: string[] = [];
    if (!deps['@guidekit/core']) missing.push('@guidekit/core');
    if (!deps['@guidekit/react']) missing.push('@guidekit/react');
    if (!deps['@guidekit/server']) missing.push('@guidekit/server');

    if (missing.length > 0) {
      warn(`Missing packages: ${missing.join(', ')}`);
      log(`  Run: ${c.cyan}npm install ${missing.join(' ')}${c.reset}`);
      log('');
    } else {
      success('All GuideKit packages are installed');
    }
  }

  // Step 2: Auth mode selection
  const authMode = await select('How do you want to authenticate?', [
    'Token endpoint (recommended for production)',
    'Direct API keys (quick prototyping only)',
  ]);

  log('');

  // Step 3: Create .env file
  const envPath = path.join(root, '.env.local');
  if (!fileExists(envPath) && !fileExists(path.join(root, '.env'))) {
    const createEnv = await confirm('Create .env.local with GuideKit variables?');
    if (createEnv) {
      writeFile(envPath, envTemplate());
      success(`Created ${c.dim}${path.relative(root, envPath)}${c.reset}`);
    }
  } else {
    info('.env file already exists — make sure GUIDEKIT_SECRET and LLM_API_KEY are set');
  }

  // Step 4: Create token endpoint (if token auth)
  if (authMode === 0) {
    const tokenPath = getTokenEndpointPath(root, framework);
    if (!fileExists(tokenPath)) {
      const createToken = await confirm(`Create token endpoint at ${c.dim}${path.relative(root, tokenPath)}${c.reset}?`);
      if (createToken) {
        writeFile(tokenPath, tokenEndpointTemplate(framework));
        success(`Created ${c.dim}${path.relative(root, tokenPath)}${c.reset}`);
      }
    } else {
      info('Token endpoint already exists');
    }
  }

  // Step 5: Create provider wrapper (for Next.js App Router)
  if (framework === 'nextjs-app') {
    const providerPath = getProviderPath(root, framework);
    if (providerPath && !fileExists(providerPath)) {
      const createProvider = await confirm(`Create provider component at ${c.dim}${path.relative(root, providerPath)}${c.reset}?`);
      if (createProvider) {
        writeFile(providerPath, providerTemplate(framework));
        success(`Created ${c.dim}${path.relative(root, providerPath)}${c.reset}`);
      }
    }
  }

  // Step 6: Summary
  log('');
  heading('Next steps');

  log(`  ${c.bold}1.${c.reset} Generate a signing secret:`);
  log(`     ${c.cyan}npx guidekit generate-secret${c.reset}`);
  log('');
  log(`  ${c.bold}2.${c.reset} Add your API keys to ${c.cyan}.env.local${c.reset}`);
  log('');
  log(`  ${c.bold}3.${c.reset} Wrap your app in ${c.cyan}<GuideKitProvider>${c.reset}`);

  if (framework === 'nextjs-app') {
    log(`     Import the Providers component in your layout.tsx`);
  }

  log('');
  log(`  ${c.bold}4.${c.reset} Run the doctor to verify your setup:`);
  log(`     ${c.cyan}npx guidekit doctor${c.reset}`);
  log('');

  success('Setup complete!');
}
