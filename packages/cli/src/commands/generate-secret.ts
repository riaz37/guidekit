// ---------------------------------------------------------------------------
// guidekit generate-secret — Generate a signing secret for JWT tokens
// ---------------------------------------------------------------------------

import * as path from 'node:path';
import { generateSecret } from '@guidekit/server';
import {
  c,
  log,
  success,
  warn,
  heading,
  copyToClipboard,
  findProjectRoot,
  fileExists,
  writeFile,
} from '../utils.js';
import { updateEnvFile } from './init.js';
import { confirm } from '../prompts.js';

export type GenerateSecretResult = {
  secret: string;
  writtenTo?: string;
  copied?: boolean;
};

export type GenerateSecretOptions = {
  nonInteractive?: boolean;
  silent?: boolean;
  writeEnv?: boolean;
  copy?: boolean;
};

export async function runGenerateSecret(
  options: GenerateSecretOptions = {},
): Promise<GenerateSecretResult> {
  if (!options.silent) heading('GuideKit — Generate Signing Secret');

  const secret = generateSecret();

  if (!options.silent) {
    success('Generated a cryptographically random 256-bit signing secret:\n');
    log(`  ${c.bold}${secret}${c.reset}\n`);
  }

  const root = findProjectRoot();
  let writtenTo: string | undefined;
  let copied = false;

  let shouldWriteEnv = options.writeEnv;
  if (shouldWriteEnv === undefined && !options.silent && !options.nonInteractive) {
    shouldWriteEnv = await confirm('Write GUIDEKIT_SECRET to .env.local?', {
      defaultValue: true,
    });
  }

  if (shouldWriteEnv) {
    const envPath = path.join(root, '.env.local');
    try {
      if (!fileExists(envPath)) {
        writeFile(envPath, `GUIDEKIT_SECRET=${secret}\n`);
      } else {
        updateEnvFile(envPath, 'GUIDEKIT_SECRET', secret);
      }
      writtenTo = envPath;
      if (!options.silent) success(`Saved GUIDEKIT_SECRET to ${c.cyan}${writtenTo}${c.reset}`);
    } catch (err) {
      if (!options.silent) {
        warn(`Could not write .env.local: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  let shouldCopy = options.copy;
  if (shouldCopy === undefined && !options.silent && !options.nonInteractive) {
    shouldCopy = await confirm('Copy secret to clipboard?', { defaultValue: false });
  }

  if (shouldCopy) {
    copied = await copyToClipboard(secret);
    if (!options.silent) {
      if (copied) success('Copied secret to clipboard');
      else warn('Could not copy to clipboard (clipboard tool not available)');
    }
  }

  if (!options.silent) {
    if (!writtenTo) {
      log(`Add this to your ${c.cyan}.env${c.reset} file:\n`);
      log(`  ${c.dim}GUIDEKIT_SECRET=${secret}${c.reset}\n`);
    }
    log(`${c.yellow}Warning:${c.reset} Keep this secret safe. Never commit it to version control.`);
  }

  return { secret, writtenTo, copied };
}
