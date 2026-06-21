// ---------------------------------------------------------------------------
// guidekit doctor — Validate API keys and provider connectivity
// ---------------------------------------------------------------------------

import * as path from 'node:path';
import { generateSecret } from '@guidekit/server';
import {
  c,
  log,
  success,
  warn,
  error,
  info,
  fileExists,
  readFile,
  writeFile,
  findProjectRoot,
  detectFramework,
} from '../utils.js';
import {
  envTemplate,
  getApiRoutePath,
  getLayoutPath,
  getProviderPath,
  getProxyRoutesLibPath,
  maybeWireProvidersInLayout,
  scaffoldNextProxyRoutes,
  scaffoldProvider,
  updateEnvFile,
  type FileOperationResult,
} from './init.js';
import { intro, outro, confirm } from '../prompts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DoctorCheckStatus = 'ok' | 'warn' | 'error' | 'skip';

export type DoctorCheck = {
  name: string;
  status: DoctorCheckStatus;
  message: string;
  fix?: () => Promise<void>;
  fixLabel?: string;
};

export type DoctorOptions = {
  fix?: boolean;
  json?: boolean;
  cwd?: string;
  silent?: boolean;
};

export type DoctorResult = {
  checks: DoctorCheck[];
  errors: number;
  warnings: number;
  fixesApplied: string[];
};

// ---------------------------------------------------------------------------
// Environment checks
// ---------------------------------------------------------------------------

function checkEnvFile(root: string): DoctorCheck {
  const envPath = path.join(root, '.env');
  const envLocalPath = path.join(root, '.env.local');

  if (fileExists(envLocalPath)) {
    return { name: '.env file', status: 'ok', message: 'Found .env.local' };
  }
  if (fileExists(envPath)) {
    return { name: '.env file', status: 'ok', message: 'Found .env' };
  }
  return {
    name: '.env file',
    status: 'warn',
    message: 'No .env or .env.local found. API keys should be in environment variables.',
    fix: async () => {
      writeFile(envLocalPath, envTemplate());
    },
    fixLabel: 'Create .env.local with GuideKit variables',
  };
}

function checkGuidekitSecret(root: string): DoctorCheck {
  const secret = process.env.GUIDEKIT_SECRET;
  if (!secret) {
    return {
      name: 'GUIDEKIT_SECRET',
      status: 'warn',
      message: 'Not set. Run `npx guidekit generate-secret` to create one.',
      fix: async () => {
        const envLocalPath = path.join(root, '.env.local');
        if (!fileExists(envLocalPath)) {
          writeFile(envLocalPath, envTemplate());
        }
        updateEnvFile(envLocalPath, 'GUIDEKIT_SECRET', generateSecret());
      },
      fixLabel: 'Generate signing secret in .env.local',
    };
  }
  if (secret.length < 32) {
    return {
      name: 'GUIDEKIT_SECRET',
      status: 'error',
      message: 'Secret is too short (< 32 chars). Generate a new one with `npx guidekit generate-secret`.',
      fix: async () => {
        const envLocalPath = path.join(root, '.env.local');
        if (!fileExists(envLocalPath)) {
          writeFile(envLocalPath, envTemplate());
        }
        updateEnvFile(envLocalPath, 'GUIDEKIT_SECRET', generateSecret());
      },
      fixLabel: 'Regenerate signing secret in .env.local',
    };
  }
  return { name: 'GUIDEKIT_SECRET', status: 'ok', message: 'Set and valid length' };
}

function checkLlmApiKey(): DoctorCheck {
  const key = process.env.LLM_API_KEY || process.env.GEMINI_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY;
  if (!key) {
    return {
      name: 'LLM API Key',
      status: 'warn',
      message: 'Not found (LLM_API_KEY / GEMINI_KEY / GEMINI_API_KEY / GOOGLE_AI_KEY). Required for LLM.',
    };
  }
  if (!key.startsWith('AI') && key.length < 20) {
    return {
      name: 'LLM API Key',
      status: 'warn',
      message: 'Key format looks unusual. Verify with your LLM provider.',
    };
  }
  return { name: 'LLM API Key', status: 'ok', message: 'Found' };
}

function checkSttApiKey(): DoctorCheck {
  const key = process.env.STT_API_KEY || process.env.DEEPGRAM_KEY || process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return {
      name: 'STT API Key',
      status: 'skip',
      message:
        'Not set (optional — browser Web Speech STT works without a server key; Deepgram/ElevenLabs need STT_API_KEY)',
    };
  }
  return { name: 'STT API Key', status: 'ok', message: 'Found' };
}

function checkTtsApiKey(): DoctorCheck {
  const key = process.env.TTS_API_KEY || process.env.ELEVENLABS_KEY || process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return {
      name: 'TTS API Key',
      status: 'skip',
      message:
        'Not set (optional — browser Web Speech TTS works without a server key; ElevenLabs needs TTS_API_KEY)',
    };
  }
  return { name: 'TTS API Key', status: 'ok', message: 'Found' };
}

function checkGitignore(root: string): DoctorCheck {
  const gitignorePath = path.join(root, '.gitignore');
  if (!fileExists(gitignorePath)) {
    return {
      name: '.gitignore',
      status: 'warn',
      message: 'No .gitignore found. Ensure .env files are not committed.',
      fix: async () => {
        writeFile(gitignorePath, '.env\n.env.local\n');
      },
      fixLabel: 'Create .gitignore ignoring .env files',
    };
  }
  const content = readFile(gitignorePath);
  if (!content.includes('.env')) {
    return {
      name: '.gitignore',
      status: 'warn',
      message: '.env is not in .gitignore. API keys could be accidentally committed.',
      fix: async () => {
        writeFile(gitignorePath, `${content.trimEnd()}\n.env\n.env.local\n`);
      },
      fixLabel: 'Add .env to .gitignore',
    };
  }
  return { name: '.gitignore', status: 'ok', message: '.env files are ignored' };
}

// ---------------------------------------------------------------------------
// Package checks
// ---------------------------------------------------------------------------

function checkPackageInstalled(root: string, pkg: string): DoctorCheck {
  const pkgPath = path.join(root, 'package.json');
  if (!fileExists(pkgPath)) {
    return { name: pkg, status: 'error', message: 'No package.json found' };
  }

  const pkgJson = JSON.parse(readFile(pkgPath));
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

  if (deps[pkg]) {
    return { name: pkg, status: 'ok', message: `Installed (${deps[pkg]})` };
  }
  return { name: pkg, status: 'error', message: 'Not installed' };
}

function projectUsesVoiceMode(root: string): boolean {
  const candidates = [
    path.join(root, 'app', 'providers.tsx'),
    path.join(root, 'src', 'app', 'providers.tsx'),
    path.join(root, 'app', 'layout.tsx'),
    path.join(root, 'src', 'app', 'layout.tsx'),
  ];

  for (const filePath of candidates) {
    if (!fileExists(filePath)) continue;
    const content = readFile(filePath);
    if (
      content.includes("mode: 'voice'") ||
      content.includes('mode: "voice"') ||
      content.includes('NEXT_PUBLIC_GUIDEKIT_VOICE') ||
      content.includes("options={{ mode: 'voice'")
    ) {
      return true;
    }
  }

  if (process.env.NEXT_PUBLIC_GUIDEKIT_VOICE === '1') {
    return true;
  }
  if (process.env.NEXT_PUBLIC_GUIDEKIT_VOICE !== '0') {
    const exampleProviders = path.join(root, 'apps', 'example-nextjs', 'app', 'providers.tsx');
    if (fileExists(exampleProviders)) {
      const content = readFile(exampleProviders);
      if (content.includes('NEXT_PUBLIC_GUIDEKIT_VOICE')) {
        return true;
      }
    }
  }

  return false;
}

function checkVadPackage(root: string): DoctorCheck {
  const pkgPath = path.join(root, 'package.json');
  if (!fileExists(pkgPath)) {
    return { name: '@guidekit/vad', status: 'skip', message: 'No package.json found' };
  }

  const pkgJson = JSON.parse(readFile(pkgPath)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const usesReact = Boolean(deps['@guidekit/react']);
  if (!usesReact) {
    return {
      name: '@guidekit/vad',
      status: 'skip',
      message: 'Not applicable (install @guidekit/react first for voice UI)',
    };
  }

  const voiceEnabled = projectUsesVoiceMode(root);
  if (!deps['@guidekit/vad']) {
    return {
      name: '@guidekit/vad',
      status: voiceEnabled ? 'error' : 'warn',
      message: voiceEnabled
        ? 'Required for voice mode — run: npm install @guidekit/vad'
        : 'Not installed (required when enabling options.mode = "voice")',
    };
  }

  if (!fileExists(path.join(root, 'node_modules', '@guidekit', 'vad'))) {
    return {
      name: '@guidekit/vad',
      status: 'error',
      message: 'Listed in package.json but missing from node_modules. Run npm install.',
    };
  }

  return { name: '@guidekit/vad', status: 'ok', message: 'Installed (Silero VAD for mic pipeline)' };
}

function checkPlatformPackages(root: string): DoctorCheck[] {
  const pkgPath = path.join(root, 'package.json');
  if (!fileExists(pkgPath)) return [];

  const pkg = JSON.parse(readFile(pkgPath)) as { dependencies?: Record<string, string> };
  const deps = { ...pkg.dependencies, ...(pkg as { devDependencies?: Record<string, string> }).devDependencies };
  const platformPackages = ['@guidekit/intelligence', '@guidekit/knowledge', '@guidekit/plugins'] as const;
  const installed = platformPackages.filter((name) => deps[name]);

  if (installed.length === 0) return [];

  const missing = platformPackages.filter((name) => deps[name] && !fileExists(path.join(root, 'node_modules', name)));
  if (missing.length > 0) {
    return [{
      name: 'Platform Mode packages',
      status: 'error',
      message: `Missing installed packages: ${missing.join(', ')}. Run npm install.`,
    }];
  }

  return [{
    name: 'Platform Mode packages',
    status: 'ok',
    message: `Installed: ${installed.join(', ')}`,
  }];
}

function checkVoiceBrowserNote(): DoctorCheck {
  return {
    name: 'Voice browser support',
    status: 'skip',
    message:
      'Use Chrome or Edge for Web Speech STT/TTS; Firefox needs Deepgram STT. Mic requires HTTPS or localhost.',
  };
}

// ---------------------------------------------------------------------------
// Integration checks
// ---------------------------------------------------------------------------

function checkProxyRouteFiles(root: string): DoctorCheck[] {
  const framework = detectFramework(root);
  if (framework !== 'nextjs-app') {
    return [{
      name: 'Proxy routes',
      status: 'skip',
      message: 'Next.js App Router integration checks apply only to nextjs-app projects',
    }];
  }

  const required = [
    { name: 'guidekit-routes helper', filePath: getProxyRoutesLibPath(root) },
    { name: 'token route', filePath: getApiRoutePath(root, 'token') },
    { name: 'LLM proxy route', filePath: getApiRoutePath(root, 'llm') },
    { name: 'health route', filePath: getApiRoutePath(root, 'health') },
  ];

  const missing = required.filter((entry) => !fileExists(entry.filePath));
  if (missing.length === 0) {
    return [{
      name: 'Proxy routes',
      status: 'ok',
      message: 'lib/guidekit-routes.ts and token/llm/health routes are present',
    }];
  }

  return [{
    name: 'Proxy routes',
    status: 'warn',
    message: `Missing: ${missing.map((entry) => entry.name).join(', ')}. Run npx guidekit init to scaffold proxy mode.`,
    fix: async () => {
      const opResult: FileOperationResult = { createdFiles: [], skippedFiles: [], warnings: [], nextSteps: [] };
      await scaffoldNextProxyRoutes(root, false, opResult, true);
    },
    fixLabel: 'Scaffold missing proxy routes',
  }];
}

function checkProviderWiring(root: string): DoctorCheck {
  const framework = detectFramework(root);
  if (framework !== 'nextjs-app') {
    return {
      name: 'Provider wiring',
      status: 'skip',
      message: 'Next.js App Router layout checks apply only to nextjs-app projects',
    };
  }

  const layoutPath = getLayoutPath(root);
  if (!fileExists(layoutPath)) {
    return {
      name: 'Provider wiring',
      status: 'warn',
      message: 'No app/layout.tsx found. Wrap your app in GuideKitProvider or Providers.',
    };
  }

  const layoutContent = readFile(layoutPath);
  const wired =
    layoutContent.includes('GuideKitProvider') ||
    layoutContent.includes('<Providers') ||
    layoutContent.includes("from './providers'") ||
    layoutContent.includes('from "./providers"');

  if (wired) {
    return {
      name: 'Provider wiring',
      status: 'ok',
      message: 'layout.tsx imports GuideKitProvider or Providers',
    };
  }

  return {
    name: 'Provider wiring',
    status: 'warn',
    message: 'layout.tsx does not import Providers. Import ./providers and wrap {children}.',
    fix: async () => {
      const opResult: FileOperationResult = { createdFiles: [], skippedFiles: [], warnings: [], nextSteps: [] };
      const providerPath = getProviderPath(root, framework);
      if (providerPath && !fileExists(providerPath)) {
        await scaffoldProvider(root, opResult, framework, false, 'text', true);
      }
      await maybeWireProvidersInLayout(root, opResult, true);
    },
    fixLabel: 'Create provider component and wire layout.tsx',
  };
}

// ---------------------------------------------------------------------------
// Connectivity checks
// ---------------------------------------------------------------------------

async function checkProviderConnectivity(
  name: string,
  url: string,
): Promise<DoctorCheck> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok || response.status === 401 || response.status === 403 || response.status === 405) {
      return { name: `${name} connectivity`, status: 'ok', message: 'Reachable' };
    }
    return {
      name: `${name} connectivity`,
      status: 'warn',
      message: `HTTP ${response.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('abort')) {
      return { name: `${name} connectivity`, status: 'error', message: 'Timeout (5s)' };
    }
    return { name: `${name} connectivity`, status: 'error', message };
  }
}

function detectDevServerPort(root: string): number {
  const pkgPath = path.join(root, 'package.json');
  if (!fileExists(pkgPath)) return 3000;

  const pkg = JSON.parse(readFile(pkgPath)) as { scripts?: Record<string, string> };
  const devScript = pkg.scripts?.dev ?? pkg.scripts?.start ?? '';
  const portMatch = devScript.match(/(?:^|\s)(?:-p|--port)\s+(\d+)/);
  if (portMatch) return Number(portMatch[1]);

  const portEnvMatch = devScript.match(/PORT=(\d+)/);
  if (portEnvMatch) return Number(portEnvMatch[1]);

  return 3000;
}

async function checkLocalGuidekitEndpoint(
  name: string,
  url: string,
  method: 'GET' | 'POST',
): Promise<DoctorCheck> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);

    const response = await fetch(url, {
      method,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      return { name, status: 'ok', message: `Responded HTTP ${response.status}` };
    }

    if (response.status === 401 || response.status === 403 || response.status === 405) {
      return { name, status: 'ok', message: `Reachable (HTTP ${response.status})` };
    }

    return {
      name,
      status: 'warn',
      message: `HTTP ${response.status} from ${url}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('abort')) {
      return { name, status: 'warn', message: 'Timed out — is your dev server running?' };
    }
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('fetch failed') ||
      message.includes('Failed to fetch')
    ) {
      return {
        name,
        status: 'warn',
        message: 'Dev server not reachable. Start it and re-run doctor.',
      };
    }
    return { name, status: 'warn', message };
  }
}

async function checkLocalIntegration(root: string): Promise<DoctorCheck[]> {
  const framework = detectFramework(root);
  if (framework !== 'nextjs-app') return [];

  const port = detectDevServerPort(root);
  const baseUrl = `http://localhost:${port}`;

  return Promise.all([
    checkLocalGuidekitEndpoint('Local token endpoint', `${baseUrl}/api/guidekit/token`, 'POST'),
    checkLocalGuidekitEndpoint('Local health endpoint', `${baseUrl}/api/guidekit/health`, 'GET'),
  ]);
}

// ---------------------------------------------------------------------------
// GuideKit repo parity checks
// ---------------------------------------------------------------------------

function checkGuideKitRepoParity(root: string): DoctorCheck[] {
  const tokenRoutePath = path.join(root, 'apps', 'example-nextjs', 'app', 'api', 'guidekit', 'token', 'route.ts');
  const nightlyWorkflowPath = path.join(root, '.github', 'workflows', 'nightly.yml');
  const ciWorkflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
  const playwrightConfigPath = path.join(root, 'playwright.config.ts');

  if (
    !fileExists(tokenRoutePath) ||
    !fileExists(nightlyWorkflowPath) ||
    !fileExists(ciWorkflowPath) ||
    !fileExists(playwrightConfigPath)
  ) {
    return [];
  }

  const tokenRoute = readFile(tokenRoutePath);
  const nightlyWorkflow = readFile(nightlyWorkflowPath);
  const ciWorkflow = readFile(ciWorkflowPath);
  const playwrightConfig = readFile(playwrightConfigPath);

  const routeRequiresSecret = tokenRoute.includes('process.env.GUIDEKIT_SECRET');
  const nightlySeedsSecret =
    nightlyWorkflow.includes('GUIDEKIT_SECRET: guidekit-example-e2e-secret-32-chars');
  const playwrightSeedsSecret =
    playwrightConfig.includes('const E2E_GUIDEKIT_SECRET') &&
    playwrightConfig.includes('GUIDEKIT_SECRET: E2E_GUIDEKIT_SECRET');
  const ciRunsE2EOnPullRequests =
    ciWorkflow.includes('pull_request:') &&
    ciWorkflow.includes('name: E2E Tests') &&
    !ciWorkflow.includes("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
  const nightlyAuditBlocks =
    nightlyWorkflow.includes('pnpm audit --prod') &&
    !nightlyWorkflow.includes('pnpm audit --prod || true');

  const parityIssues: string[] = [];
  if (!routeRequiresSecret) parityIssues.push('token route no longer enforces GUIDEKIT_SECRET');
  if (!nightlySeedsSecret) parityIssues.push('Nightly does not seed a deterministic test secret');
  if (!playwrightSeedsSecret) parityIssues.push('Playwright webServer does not seed a deterministic test secret');

  const results: DoctorCheck[] = [
    {
      name: 'GuideKit repo parity',
      status: parityIssues.length === 0 ? 'ok' : 'warn',
      message: parityIssues.length === 0
        ? 'Example token route and automated E2E secret seeding are aligned for local and CI parity.'
        : `Repo parity gaps: ${parityIssues.join('; ')}`,
    },
    {
      name: 'Hosted E2E signal',
      status: ciRunsE2EOnPullRequests ? 'ok' : 'warn',
      message: ciRunsE2EOnPullRequests
        ? 'Pull requests receive a hosted E2E signal before release-confidence fixes are merged.'
        : 'Pull requests do not currently get a hosted E2E signal.',
    },
    {
      name: 'Nightly dependency audit gate',
      status: nightlyAuditBlocks ? 'ok' : 'warn',
      message: nightlyAuditBlocks
        ? 'Nightly fails when production dependency advisories are detected.'
        : 'Nightly is not enforcing the production dependency audit exit code.',
    },
  ];

  return results;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printCheck(check: DoctorCheck): void {
  let icon: string;
  let color: string;
  switch (check.status) {
    case 'ok':
      icon = '✓';
      color = c.green;
      break;
    case 'warn':
      icon = '!';
      color = c.yellow;
      break;
    case 'error':
      icon = '✗';
      color = c.red;
      break;
    case 'skip':
      icon = '○';
      color = c.dim;
      break;
  }
  log(`  ${color}${icon}${c.reset} ${check.name}: ${c.dim}${check.message}${c.reset}`);
}

function printSection(title: string, checks: DoctorCheck[], silent: boolean): void {
  if (silent || checks.length === 0) return;
  log(`${c.bold}${title}${c.reset}`);
  for (const check of checks) {
    printCheck(check);
  }
  log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const root = options.cwd ?? findProjectRoot();
  const autoFix = options.fix ?? false;
  const silent = options.silent ?? false;

  const result: DoctorResult = {
    checks: [],
    errors: 0,
    warnings: 0,
    fixesApplied: [],
  };

  if (!silent) {
    intro('GuideKit Doctor', 'Checking your setup');
    info(`Project root: ${c.dim}${root}${c.reset}`);
    log('');
  }

  // Environment
  const envChecks = [
    checkEnvFile(root),
    checkGitignore(root),
    checkGuidekitSecret(root),
    checkLlmApiKey(),
    checkSttApiKey(),
    checkTtsApiKey(),
  ];
  printSection('Environment', envChecks, silent);
  result.checks.push(...envChecks);

  // Packages
  const packageChecks = [
    checkPackageInstalled(root, '@guidekit/core'),
    checkPackageInstalled(root, '@guidekit/react'),
    checkPackageInstalled(root, '@guidekit/server'),
    checkVadPackage(root),
    ...checkPlatformPackages(root),
  ];
  printSection('Packages', packageChecks, silent);
  result.checks.push(...packageChecks);

  // Voice
  const voiceChecks = [checkVoiceBrowserNote()];
  printSection('Voice', voiceChecks, silent);
  result.checks.push(...voiceChecks);

  // Integration
  const integrationChecks = [...checkProxyRouteFiles(root), checkProviderWiring(root)];
  printSection('Integration', integrationChecks, silent);
  result.checks.push(...integrationChecks);

  // Connectivity
  const connectivityChecks = await Promise.all([
    checkProviderConnectivity('Google AI', 'https://generativelanguage.googleapis.com'),
    checkProviderConnectivity('Deepgram', 'https://api.deepgram.com'),
    checkProviderConnectivity('ElevenLabs', 'https://api.elevenlabs.io'),
  ]);
  printSection('Connectivity', connectivityChecks, silent);
  result.checks.push(...connectivityChecks);

  // Local endpoints
  const localChecks = await checkLocalIntegration(root);
  printSection('Local endpoints', localChecks, silent);
  result.checks.push(...localChecks);

  // Repo parity
  const repoChecks = checkGuideKitRepoParity(root);
  printSection('GuideKit Repo Parity', repoChecks, silent);
  result.checks.push(...repoChecks);

  // Count
  for (const check of result.checks) {
    if (check.status === 'error') result.errors++;
    if (check.status === 'warn') result.warnings++;
  }

  // Remediation
  const fixable = result.checks.filter(
    (check) => check.fix && (check.status === 'warn' || check.status === 'error'),
  );

  if (fixable.length > 0 && !silent) {
    const shouldFix = autoFix || await confirm(
      `${fixable.length} issue(s) can be fixed automatically. Apply fixes?`,
      { defaultValue: false },
    );

    if (shouldFix) {
      for (const check of fixable) {
        if (!check.fix) continue;
        try {
          await check.fix();
          result.fixesApplied.push(check.name);
          success(`Fixed: ${check.name}`);
        } catch (err) {
          error(`Failed to fix ${check.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      log('');
    }
  }

  // Summary
  if (!silent) {
    if (result.errors > 0) {
      error(`${result.errors} error(s) found. Fix these before deploying.`);
    } else if (result.warnings > 0) {
      warn(`${result.warnings} warning(s). Everything should work, but review the warnings above.`);
    } else {
      success('All checks passed! Your GuideKit setup looks good.');
    }
    outro('Doctor complete');
  }

  return result;
}
