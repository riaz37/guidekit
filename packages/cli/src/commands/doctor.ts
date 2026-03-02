// ---------------------------------------------------------------------------
// guidekit doctor — Validate API keys and provider connectivity
// ---------------------------------------------------------------------------

import { c, log, success, warn, error, info, heading, fileExists, readFile, findProjectRoot } from '../utils.js';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'skip';
  message: string;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkEnvFile(root: string): CheckResult {
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
  };
}

function checkGuidekitSecret(): CheckResult {
  const secret = process.env.GUIDEKIT_SECRET;
  if (!secret) {
    return {
      name: 'GUIDEKIT_SECRET',
      status: 'warn',
      message: 'Not set. Run `npx guidekit generate-secret` to create one.',
    };
  }
  if (secret.length < 32) {
    return {
      name: 'GUIDEKIT_SECRET',
      status: 'error',
      message: 'Secret is too short (< 32 chars). Generate a new one with `npx guidekit generate-secret`.',
    };
  }
  return { name: 'GUIDEKIT_SECRET', status: 'ok', message: 'Set and valid length' };
}

function checkGeminiKey(): CheckResult {
  const key = process.env.GEMINI_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY;
  if (!key) {
    return {
      name: 'Gemini API Key',
      status: 'warn',
      message: 'Not found (GEMINI_KEY / GEMINI_API_KEY / GOOGLE_AI_KEY). Required for LLM.',
    };
  }
  if (!key.startsWith('AI') && key.length < 20) {
    return {
      name: 'Gemini API Key',
      status: 'warn',
      message: 'Key format looks unusual. Verify at https://aistudio.google.com/apikey',
    };
  }
  return { name: 'Gemini API Key', status: 'ok', message: 'Found' };
}

function checkDeepgramKey(): CheckResult {
  const key = process.env.DEEPGRAM_KEY || process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return {
      name: 'Deepgram API Key',
      status: 'skip',
      message: 'Not set (optional — required for voice/STT)',
    };
  }
  return { name: 'Deepgram API Key', status: 'ok', message: 'Found' };
}

function checkElevenlabsKey(): CheckResult {
  const key = process.env.ELEVENLABS_KEY || process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return {
      name: 'ElevenLabs API Key',
      status: 'skip',
      message: 'Not set (optional — required for voice/TTS)',
    };
  }
  return { name: 'ElevenLabs API Key', status: 'ok', message: 'Found' };
}

function checkPackageInstalled(root: string, pkg: string): CheckResult {
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

function checkGitignore(root: string): CheckResult {
  const gitignorePath = path.join(root, '.gitignore');
  if (!fileExists(gitignorePath)) {
    return {
      name: '.gitignore',
      status: 'warn',
      message: 'No .gitignore found. Ensure .env files are not committed.',
    };
  }
  const content = readFile(gitignorePath);
  if (!content.includes('.env')) {
    return {
      name: '.gitignore',
      status: 'warn',
      message: '.env is not in .gitignore. API keys could be accidentally committed.',
    };
  }
  return { name: '.gitignore', status: 'ok', message: '.env files are ignored' };
}

async function checkProviderConnectivity(
  name: string,
  url: string,
): Promise<CheckResult> {
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runDoctor(): Promise<void> {
  heading('GuideKit Doctor — Checking your setup');

  const root = findProjectRoot();
  info(`Project root: ${c.dim}${root}${c.reset}`);
  log('');

  const results: CheckResult[] = [];

  // Static checks
  log(`${c.bold}Environment${c.reset}`);
  results.push(checkEnvFile(root));
  results.push(checkGitignore(root));
  results.push(checkGuidekitSecret());
  results.push(checkGeminiKey());
  results.push(checkDeepgramKey());
  results.push(checkElevenlabsKey());

  log(`${c.bold}Packages${c.reset}`);
  results.push(checkPackageInstalled(root, '@guidekit/core'));
  results.push(checkPackageInstalled(root, '@guidekit/react'));
  results.push(checkPackageInstalled(root, '@guidekit/server'));

  // Connectivity checks
  log(`${c.bold}Connectivity${c.reset}`);
  results.push(await checkProviderConnectivity('Google AI', 'https://generativelanguage.googleapis.com'));
  results.push(await checkProviderConnectivity('Deepgram', 'https://api.deepgram.com'));
  results.push(await checkProviderConnectivity('ElevenLabs', 'https://api.elevenlabs.io'));

  // Print results
  log('');
  heading('Results');

  let errors = 0;
  let warnings = 0;

  for (const result of results) {
    let icon: string;
    let color: string;
    switch (result.status) {
      case 'ok':
        icon = '✓';
        color = c.green;
        break;
      case 'warn':
        icon = '!';
        color = c.yellow;
        warnings++;
        break;
      case 'error':
        icon = '✗';
        color = c.red;
        errors++;
        break;
      case 'skip':
        icon = '○';
        color = c.dim;
        break;
    }
    log(`  ${color}${icon}${c.reset} ${result.name}: ${c.dim}${result.message}${c.reset}`);
  }

  log('');

  if (errors > 0) {
    error(`${errors} error(s) found. Fix these before deploying.`);
  } else if (warnings > 0) {
    warn(`${warnings} warning(s). Everything should work, but review the warnings above.`);
  } else {
    success('All checks passed! Your GuideKit setup looks good.');
  }
}
