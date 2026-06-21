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
import { select } from './prompts.js';

const VERSION = '1.0.0';

const HELP = `
${c.bold}guidekit${c.reset} — CLI tools for GuideKit SDK

${c.bold}Usage:${c.reset}
  guidekit <command>

${c.bold}Commands:${c.reset}
  init              Scaffold GuideKit configuration in your project
  init --platform   Also scaffold Platform Mode packages and provider props
  doctor            Validate API keys, packages, and provider connectivity
  generate-secret   Generate a signing secret for JWT token authentication

${c.bold}Init options:${c.reset}
  --yes             Skip interactive prompts and use defaults
  --platform        Enable Platform Mode (RAG, plugins, intelligence)
  --auth-mode       token | direct (default: token)
  --json            Output the result as JSON (implies --yes)

${c.bold}Doctor options:${c.reset}
  --fix             Apply safe fixes automatically
  --json            Output the result as JSON

${c.bold}Generate-secret options:${c.reset}
  --write-env       Write GUIDEKIT_SECRET to .env.local
  --copy            Copy the secret to the clipboard
  --json            Output the result as JSON

${c.bold}Global options:${c.reset}
  --help, -h        Show this help message
  --version, -v     Show version number

${c.bold}Examples:${c.reset}
  ${c.dim}$ npx guidekit init${c.reset}
  ${c.dim}$ npx guidekit init --yes --platform${c.reset}
  ${c.dim}$ npx guidekit init --yes --auth-mode direct${c.reset}
  ${c.dim}$ npx guidekit doctor${c.reset}
  ${c.dim}$ npx guidekit doctor --fix${c.reset}
  ${c.dim}$ npx guidekit generate-secret${c.reset}
  ${c.dim}$ npx guidekit generate-secret --write-env --copy${c.reset}

${c.dim}Documentation: https://guidekit-docs.vercel.app/docs/cli${c.reset}
`;

function isInteractiveEnvironment(): boolean {
  return (
    typeof process !== 'undefined' &&
    !!process.stdin?.isTTY &&
    !!process.stdout?.isTTY &&
    process.env.CI !== 'true'
  );
}

async function showInteractiveMenu(): Promise<void> {
  const choice = await select('What would you like to do?', [
    {
      value: 'init',
      label: 'init — Scaffold GuideKit configuration',
      hint: 'Set up config, env, and proxy routes',
    },
    {
      value: 'doctor',
      label: 'doctor — Validate setup',
      hint: 'Check API keys, packages, and connectivity',
    },
    {
      value: 'generate-secret',
      label: 'generate-secret — Create signing secret',
      hint: 'Generate GUIDEKIT_SECRET',
    },
    {
      value: 'help',
      label: 'help — Show command help',
    },
  ]);

  switch (choice) {
    case 'init':
      await runInit({});
      break;
    case 'doctor':
      await runDoctor({});
      break;
    case 'generate-secret':
      await runGenerateSecret({});
      break;
    case 'help':
    default:
      log(HELP);
  }
}

export async function run(args: string[] = process.argv.slice(2)): Promise<void> {
  const command = args[0];

  if (!command) {
    if (isInteractiveEnvironment()) {
      await showInteractiveMenu();
    } else {
      log(HELP);
    }
    return;
  }

  if (command === '--help' || command === '-h') {
    log(HELP);
    return;
  }

  if (command === '--version' || command === '-v') {
    log(VERSION);
    return;
  }

  switch (command) {
    case 'init': {
      const platformMode = args.includes('--platform');
      const nonInteractive = args.includes('--yes') || args.includes('--json');
      const silent = args.includes('--json');
      const authArgIndex = args.indexOf('--auth-mode');
      const authMode =
        authArgIndex !== -1 && args[authArgIndex + 1]
          ? (args[authArgIndex + 1] as 'token' | 'direct')
          : undefined;

      if (authMode && authMode !== 'token' && authMode !== 'direct') {
        logError(`Invalid --auth-mode: ${c.bold}${authMode}${c.reset}. Must be "token" or "direct".`);
        process.exitCode = 1;
        return;
      }

      const result = await runInit({ platformMode, authMode, nonInteractive, silent });

      if (args.includes('--json')) {
        log(JSON.stringify(result, null, 2));
      }
      break;
    }

    case 'doctor': {
      const fix = args.includes('--fix');
      const json = args.includes('--json');
      const result = await runDoctor({ fix, json, silent: json });

      if (json) {
        log(JSON.stringify(result, null, 2));
      }
      break;
    }

    case 'generate-secret': {
      const writeEnv = args.includes('--write-env');
      const copy = args.includes('--copy');
      const json = args.includes('--json');
      const result = await runGenerateSecret({
        nonInteractive: writeEnv || copy || json,
        silent: json,
        writeEnv,
        copy,
      });

      if (json) {
        log(JSON.stringify(result, null, 2));
      }
      break;
    }

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
