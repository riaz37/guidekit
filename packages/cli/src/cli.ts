// ---------------------------------------------------------------------------
// @guidekit/cli — Main CLI entry point
// ---------------------------------------------------------------------------
// Usage:
//   npx guidekit init
//   npx guidekit doctor
//   npx guidekit generate-secret
//   npx guidekit --help
//   npx guidekit --version
// ---------------------------------------------------------------------------

import { runInit } from './commands/init.js';
import { runDoctor } from './commands/doctor.js';
import { runGenerateSecret } from './commands/generate-secret.js';
import { c, log, error as logError } from './utils.js';

const VERSION = '0.1.0-beta.2';

const HELP = `
${c.bold}guidekit${c.reset} — CLI tools for GuideKit SDK

${c.bold}Usage:${c.reset}
  guidekit <command>

${c.bold}Commands:${c.reset}
  init              Scaffold GuideKit configuration in your project
  doctor            Validate API keys, packages, and provider connectivity
  generate-secret   Generate a signing secret for JWT token authentication

${c.bold}Options:${c.reset}
  --help, -h        Show this help message
  --version, -v     Show version number

${c.bold}Examples:${c.reset}
  ${c.dim}$ npx guidekit init${c.reset}
  ${c.dim}$ npx guidekit doctor${c.reset}
  ${c.dim}$ npx guidekit generate-secret${c.reset}

${c.dim}Documentation: https://guidekit-docs.vercel.app/docs/cli${c.reset}
`;

export async function run(args: string[] = process.argv.slice(2)): Promise<void> {
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    log(HELP);
    return;
  }

  if (command === '--version' || command === '-v') {
    log(VERSION);
    return;
  }

  switch (command) {
    case 'init':
      await runInit();
      break;

    case 'doctor':
      await runDoctor();
      break;

    case 'generate-secret':
      await runGenerateSecret();
      break;

    default:
      logError(`Unknown command: ${c.bold}${command}${c.reset}`);
      log(`Run ${c.cyan}guidekit --help${c.reset} for available commands.`);
      process.exitCode = 1;
  }
}

// Auto-run when executed directly
run().catch((err) => {
  logError(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
