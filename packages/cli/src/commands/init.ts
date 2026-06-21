// ---------------------------------------------------------------------------
// guidekit init — Scaffold GuideKit configuration in a project
// ---------------------------------------------------------------------------

import * as path from 'node:path';
import { generateSecret } from '@guidekit/server';
import {
  c,
  log,
  success,
  warn,
  info,
  heading,
  fileExists,
  readFile,
  writeFile,
  findProjectRoot,
  detectFramework,
} from '../utils.js';
import { intro, outro, confirm, select } from '../prompts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthMode = 'token' | 'direct';
export type GuidanceMode = 'text' | 'voice' | 'platform';

export interface FileOperationResult {
  createdFiles: string[];
  skippedFiles: string[];
  warnings: string[];
  nextSteps: string[];
}

export type InitOptions = {
  platformMode?: boolean;
  authMode?: AuthMode;
  nonInteractive?: boolean;
  cwd?: string;
  outputFormat?: 'human' | 'json';
  silent?: boolean;
};

export interface InitResult extends FileOperationResult {
  framework: string;
  authMode: AuthMode;
  platformMode: boolean;
  guidanceMode: GuidanceMode;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function tokenEndpointTemplate(framework: string, routesImportPath?: string): string {
  if (framework === 'nextjs-app' && routesImportPath) {
    return `// app/api/guidekit/token/route.ts
import { guidekitRoutes } from '${routesImportPath}';

export const POST = guidekitRoutes.POST_token;
`;
  }

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

export function nextProxyRoutesTemplate(): string {
  return `// lib/guidekit-routes.ts
import { createNextAppRouterRoutes, getSharedSessionStore } from '@guidekit/server/next';

export const guidekitRoutes = createNextAppRouterRoutes({
  signingSecret: process.env.GUIDEKIT_SECRET!,
  sessionStore: getSharedSessionStore(),
  createTokenOptions: () => ({
    llmApiKey: process.env.LLM_API_KEY!,
    sttApiKey: process.env.STT_API_KEY,
    ttsApiKey: process.env.TTS_API_KEY,
    expiresIn: '15m',
  }),
});
`;
}

export function proxyRouteTemplate(
  handler: 'POST_llm' | 'GET_health' | 'POST_stt' | 'POST_tts',
  routesImportPath: string,
): string {
  const exportName = handler.startsWith('GET') ? 'GET' : 'POST';
  return `import { guidekitRoutes } from '${routesImportPath}';

export const ${exportName} = guidekitRoutes.${handler};
`;
}

export function providerTemplate(
  framework: string,
  platformMode: boolean,
  guidanceMode: GuidanceMode,
): string {
  const platformProps = platformMode
    ? `
      proxy={{ llm: '/api/guidekit/llm', health: '/api/guidekit/health', stt: '/api/guidekit/stt', tts: '/api/guidekit/tts' }}
      llm={{ provider: 'gemini', model: 'gemini-2.5-flash' }}
      intelligence={true}
      knowledge={{ documents: [], engine: 'bm25', topK: 5 }}
      plugins={[]}
      hallucinationGuard`
    : `
      proxy={{ llm: '/api/guidekit/llm', health: '/api/guidekit/health' }}
      llm={{ provider: 'gemini', model: 'gemini-2.5-flash' }}`;

  if (framework === 'nextjs-app') {
    return `// app/providers.tsx
'use client';

import { GuideKitProvider } from '@guidekit/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GuideKitProvider
      tokenEndpoint="/api/guidekit/token"${platformProps}
      agent={{
        name: 'Guide',
        greeting: 'Hi! How can I help you today?',
      }}
      options={{
        mode: '${guidanceMode}',
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
        mode: '${guidanceMode}',
        debug: process.env.NODE_ENV === 'development',
      }}
    >
      {children}
    </GuideKitProvider>
  );
}
`;
}

export function envTemplate(): string {
  return `# GuideKit SDK Configuration
# Generate a signing secret: npx guidekit generate-secret
GUIDEKIT_SECRET=

# LLM Provider (required for proxy mode)
LLM_API_KEY=

# Voice (optional — also run: npm install @guidekit/vad)
# Browser Web Speech STT/TTS work without server keys; Deepgram/ElevenLabs use:
STT_API_KEY=
TTS_API_KEY=
# NEXT_PUBLIC_GUIDEKIT_VOICE=0
`;
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

export function usesSrcApp(root: string): boolean {
  return fileExists(path.join(root, 'src', 'app'));
}

export function getAppDir(root: string): string {
  return usesSrcApp(root)
    ? path.join(root, 'src', 'app')
    : path.join(root, 'app');
}

export function getGuidekitRoutesImportPath(root: string): string {
  return usesSrcApp(root)
    ? '../../../../../lib/guidekit-routes'
    : '../../../../lib/guidekit-routes';
}

export function getProxyRoutesLibPath(root: string): string {
  return path.join(root, 'lib', 'guidekit-routes.ts');
}

export function getApiRoutePath(root: string, segment: string): string {
  return path.join(getAppDir(root), 'api', 'guidekit', segment, 'route.ts');
}

export function getLayoutPath(root: string): string {
  return path.join(getAppDir(root), 'layout.tsx');
}

export function getTokenEndpointPath(root: string, framework: string): string {
  if (framework === 'nextjs-app') {
    return getApiRoutePath(root, 'token');
  }
  if (framework === 'nextjs-pages') {
    if (fileExists(path.join(root, 'src', 'pages'))) {
      return path.join(root, 'src', 'pages', 'api', 'guidekit', 'token.ts');
    }
    return path.join(root, 'pages', 'api', 'guidekit', 'token.ts');
  }
  return path.join(root, 'server', 'guidekit-token.ts');
}

export function getProviderPath(root: string, framework: string): string {
  if (framework === 'nextjs-app') {
    return path.join(getAppDir(root), 'providers.tsx');
  }
  return '';  // No file created for other frameworks — just show instructions
}

// ---------------------------------------------------------------------------
// Package / env helpers
// ---------------------------------------------------------------------------

function getMissingPackages(root: string, platformMode: boolean): string[] {
  const pkgPath = path.join(root, 'package.json');
  if (!fileExists(pkgPath)) return [];

  const pkg = JSON.parse(readFile(pkgPath));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const missing: string[] = [];
  if (!deps['@guidekit/core']) missing.push('@guidekit/core');
  if (!deps['@guidekit/react']) missing.push('@guidekit/react');
  if (!deps['@guidekit/server']) missing.push('@guidekit/server');
  if (deps['@guidekit/react'] && !deps['@guidekit/vad']) {
    missing.push('@guidekit/vad');
  }
  if (platformMode) {
    if (!deps['@guidekit/intelligence']) missing.push('@guidekit/intelligence');
    if (!deps['@guidekit/knowledge']) missing.push('@guidekit/knowledge');
    if (!deps['@guidekit/plugins']) missing.push('@guidekit/plugins');
  }

  return missing;
}

export function updateEnvFile(envPath: string, key: string, value: string): void {
  if (!fileExists(envPath)) return;
  const content = readFile(envPath);
  const regex = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (regex.test(content)) {
    writeFile(envPath, content.replace(regex, line));
  } else {
    writeFile(envPath, `${content.trimEnd()}\n${line}\n`);
  }
}

async function ensureEnvFile(
  root: string,
  result: InitResult,
  nonInteractive: boolean,
): Promise<void> {
  const envPath = path.join(root, '.env.local');
  const hasEnv = fileExists(envPath) || fileExists(path.join(root, '.env'));

  if (!hasEnv) {
    const shouldCreate = nonInteractive || await confirm('Create .env.local with GuideKit variables?');
    if (shouldCreate) {
      writeFile(envPath, envTemplate());
      result.createdFiles.push(path.relative(root, envPath));
      if (!nonInteractive) {
        success(`Created ${c.dim}${path.relative(root, envPath)}${c.reset}`);
      }
    } else {
      result.skippedFiles.push('.env.local');
      result.nextSteps.push('Create a .env.local file with GUIDEKIT_SECRET and LLM_API_KEY');
    }
  }

  // Generate a signing secret if one is not already configured.
  if (fileExists(envPath)) {
    const content = readFile(envPath);
    const hasSecret = content.includes('GUIDEKIT_SECRET=') && !content.match(/GUIDEKIT_SECRET=\s*$/m);
    if (!hasSecret) {
      const secret = generateSecret();
      updateEnvFile(envPath, 'GUIDEKIT_SECRET', secret);
      if (!result.createdFiles.includes(path.relative(root, envPath))) {
        result.createdFiles.push(path.relative(root, envPath));
      }
      if (!nonInteractive) {
        success('Generated a signing secret and wrote it to .env.local');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scaffolding helpers
// ---------------------------------------------------------------------------

export async function scaffoldFile(
  filePath: string,
  content: string,
  label: string,
  root: string,
  result: FileOperationResult,
  nonInteractive: boolean,
): Promise<void> {
  if (fileExists(filePath)) {
    if (nonInteractive) {
      result.skippedFiles.push(path.relative(root, filePath));
      info(`${label} already exists — skipping`);
      return;
    }

    const overwrite = await confirm(
      `${label} already exists at ${c.dim}${path.relative(root, filePath)}${c.reset}. Overwrite?`,
      { defaultValue: false },
    );
    if (!overwrite) {
      result.skippedFiles.push(path.relative(root, filePath));
      return;
    }
  }

  writeFile(filePath, content);
  const rel = path.relative(root, filePath);
  result.createdFiles.push(rel);
  if (!nonInteractive) {
    success(`Created ${c.dim}${rel}${c.reset}`);
  }
}

export async function scaffoldNextProxyRoutes(
  root: string,
  platformMode: boolean,
  result: FileOperationResult,
  nonInteractive: boolean,
): Promise<void> {
  const routesImportPath = getGuidekitRoutesImportPath(root);

  await scaffoldFile(
    getProxyRoutesLibPath(root),
    nextProxyRoutesTemplate(),
    'proxy routes helper',
    root,
    result,
    nonInteractive,
  );

  await scaffoldFile(
    getApiRoutePath(root, 'token'),
    tokenEndpointTemplate('nextjs-app', routesImportPath),
    'token endpoint',
    root,
    result,
    nonInteractive,
  );
  await scaffoldFile(
    getApiRoutePath(root, 'llm'),
    proxyRouteTemplate('POST_llm', routesImportPath),
    'LLM proxy route',
    root,
    result,
    nonInteractive,
  );
  await scaffoldFile(
    getApiRoutePath(root, 'health'),
    proxyRouteTemplate('GET_health', routesImportPath),
    'health route',
    root,
    result,
    nonInteractive,
  );

  if (platformMode) {
    await scaffoldFile(
      getApiRoutePath(root, 'stt'),
      proxyRouteTemplate('POST_stt', routesImportPath),
      'STT proxy route',
      root,
      result,
      nonInteractive,
    );
    await scaffoldFile(
      getApiRoutePath(root, 'tts'),
      proxyRouteTemplate('POST_tts', routesImportPath),
      'TTS proxy route',
      root,
      result,
      nonInteractive,
    );
  }
}

async function scaffoldTokenAuth(
  root: string,
  framework: string,
  result: InitResult,
  nonInteractive: boolean,
): Promise<void> {
  if (framework === 'nextjs-app') {
    await scaffoldNextProxyRoutes(root, result.platformMode, result, nonInteractive);
  } else {
    const tokenPath = getTokenEndpointPath(root, framework);
    await scaffoldFile(
      tokenPath,
      tokenEndpointTemplate(framework),
      'token endpoint',
      root,
      result,
      nonInteractive,
    );
  }
}

export async function scaffoldProvider(
  root: string,
  result: FileOperationResult,
  framework: string,
  platformMode: boolean,
  guidanceMode: GuidanceMode,
  nonInteractive: boolean,
): Promise<void> {
  const providerPath = getProviderPath(root, framework);
  if (!providerPath) return;

  await scaffoldFile(
    providerPath,
    providerTemplate(framework, platformMode, guidanceMode),
    'provider component',
    root,
    result,
    nonInteractive,
  );
}

export async function maybeWireProvidersInLayout(
  root: string,
  result: FileOperationResult,
  nonInteractive: boolean,
): Promise<void> {
  const layoutPath = getLayoutPath(root);
  if (!fileExists(layoutPath)) return;

  const layoutContent = readFile(layoutPath);
  if (
    layoutContent.includes('GuideKitProvider') ||
    layoutContent.includes('<Providers') ||
    layoutContent.includes("from './providers'") ||
    layoutContent.includes('from "./providers"')
  ) {
    return;
  }

  if (nonInteractive) {
    result.nextSteps.push(
      `Import Providers from ./providers in ${path.relative(root, layoutPath)} and wrap {children}`,
    );
    return;
  }

  const patch = await confirm(
    `Wrap ${c.dim}${path.relative(root, layoutPath)}${c.reset} with the Providers component?`,
    { defaultValue: true },
  );
  if (!patch) return;

  let updated = layoutContent;
  if (!updated.includes('import { Providers }')) {
    const importLine = "import { Providers } from './providers';\n";
    if (updated.includes("'use client'")) {
      updated = updated.replace(/('use client';\n)/, `$1${importLine}`);
    } else {
      updated = `${importLine}${updated}`;
    }
  }

  if (updated.includes('{children}') && !updated.includes('<Providers>')) {
    updated = updated.replace('{children}', '<Providers>{children}</Providers>');
  }

  writeFile(layoutPath, updated);
  result.createdFiles.push(path.relative(root, layoutPath));
  success(`Updated ${c.dim}${path.relative(root, layoutPath)}${c.reset}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(result: InitResult, nonInteractive: boolean): void {
  if (nonInteractive) return;

  heading('Next steps');
  log(`  ${c.bold}1.${c.reset} Add your API keys to ${c.cyan}.env.local${c.reset}`);

  for (let i = 0; i < result.nextSteps.length; i++) {
    log(`  ${c.bold}${i + 2}.${c.reset} ${result.nextSteps[i]}`);
  }

  log('');
  log(`Run ${c.cyan}npx guidekit doctor${c.reset} to verify your setup.`);
  log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? findProjectRoot();
  const framework = detectFramework(cwd);
  const nonInteractive = options.nonInteractive ?? false;
  const silent = options.silent ?? false;

  const result: InitResult = {
    framework,
    authMode: options.authMode ?? 'token',
    platformMode: options.platformMode ?? false,
    guidanceMode: 'text',
    createdFiles: [],
    skippedFiles: [],
    warnings: [],
    nextSteps: [],
  };

  if (!nonInteractive && !silent) {
    intro('GuideKit — Project Setup', `Detected framework: ${framework}`);
  }

  // Step 1: Check packages
  const missing = getMissingPackages(cwd, result.platformMode);
  if (missing.length > 0) {
    result.warnings.push(`Missing packages: ${missing.join(', ')}`);
    result.nextSteps.push(`Install missing packages: npm install ${missing.join(' ')}`);
  } else if (!nonInteractive && !silent) {
    success('All GuideKit packages are installed');
    log('');
  }

  // Step 2: Choose guidance mode
  if (!nonInteractive) {
    const guidanceMode = await select<GuidanceMode>('What kind of guidance do you want?', [
      { value: 'text', label: 'Text guidance', hint: 'Chat-based help widget' },
      { value: 'voice', label: 'Voice guidance', hint: 'Speech input + output (requires @guidekit/vad)' },
      { value: 'platform', label: 'Platform Mode', hint: 'RAG, plugins, cognitive page analysis' },
    ]);
    result.guidanceMode = guidanceMode;
    result.platformMode = result.platformMode || guidanceMode === 'platform';

    if (guidanceMode === 'voice' && !missing.includes('@guidekit/vad')) {
      result.warnings.push('Voice mode requires @guidekit/vad. Make sure to install it.');
    }
  }

  // Step 3: Choose auth mode
  if (!nonInteractive) {
    result.authMode = await select<AuthMode>('How do you want to authenticate?', [
      { value: 'token', label: 'Token endpoint (recommended)', hint: 'Server holds API keys; client gets JWT tokens' },
      { value: 'direct', label: 'Direct API keys', hint: 'Quick prototyping only — keys live in the browser' },
    ]);
  }

  // Step 4: Environment file + secret
  await ensureEnvFile(cwd, result, nonInteractive);

  // Step 5: Scaffold routes / provider
  if (result.authMode === 'token') {
    await scaffoldTokenAuth(cwd, framework, result, nonInteractive);
  } else {
    result.warnings.push(
      'Direct API key mode selected. You must set llm.apiKey in your provider manually.',
    );
  }

  if (framework === 'nextjs-app') {
    await scaffoldProvider(cwd, result, framework, result.platformMode, result.guidanceMode, nonInteractive);
    await maybeWireProvidersInLayout(cwd, result, nonInteractive);
  } else {
    result.nextSteps.push('Wrap your app root in <GuideKitProvider> with tokenEndpoint="/api/guidekit/token"');
  }

  // Step 6: Warnings + summary
  if (!silent) {
    for (const warning of result.warnings) {
      warn(warning);
    }
    if (result.warnings.length > 0) {
      log('');
    }
    outro('Setup complete');
  }
  printSummary(result, silent);

  return result;
}
