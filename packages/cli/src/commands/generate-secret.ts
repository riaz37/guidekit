// ---------------------------------------------------------------------------
// guidekit generate-secret — Generate a signing secret for JWT tokens
// ---------------------------------------------------------------------------

import { generateSecret } from '@guidekit/server';
import { c, log, success, heading } from '../utils.js';

export async function runGenerateSecret(): Promise<void> {
  heading('GuideKit — Generate Signing Secret');

  const secret = generateSecret();

  success('Generated a cryptographically random 256-bit signing secret:\n');
  log(`  ${c.bold}${secret}${c.reset}\n`);
  log(`Add this to your ${c.cyan}.env${c.reset} file:\n`);
  log(`  ${c.dim}GUIDEKIT_SECRET=${secret}${c.reset}\n`);
  log(`${c.yellow}Warning:${c.reset} Keep this secret safe. Never commit it to version control.`);
}
