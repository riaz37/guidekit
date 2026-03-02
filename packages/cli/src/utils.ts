// ---------------------------------------------------------------------------
// Shared CLI utilities
// ---------------------------------------------------------------------------

import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

// ---------------------------------------------------------------------------
// Colors (ANSI — no dependency needed)
// ---------------------------------------------------------------------------

const supportsColor =
  typeof process !== 'undefined' &&
  process.stdout?.isTTY &&
  !process.env.NO_COLOR;

export const c = {
  reset: supportsColor ? '\x1b[0m' : '',
  bold: supportsColor ? '\x1b[1m' : '',
  dim: supportsColor ? '\x1b[2m' : '',
  red: supportsColor ? '\x1b[31m' : '',
  green: supportsColor ? '\x1b[32m' : '',
  yellow: supportsColor ? '\x1b[33m' : '',
  blue: supportsColor ? '\x1b[34m' : '',
  cyan: supportsColor ? '\x1b[36m' : '',
};

export function log(msg: string): void {
  console.log(msg);
}

export function success(msg: string): void {
  console.log(`${c.green}✓${c.reset} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`${c.yellow}!${c.reset} ${msg}`);
}

export function error(msg: string): void {
  console.error(`${c.red}✗${c.reset} ${msg}`);
}

export function info(msg: string): void {
  console.log(`${c.blue}ℹ${c.reset} ${msg}`);
}

export function heading(msg: string): void {
  console.log(`\n${c.bold}${msg}${c.reset}\n`);
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(`${c.cyan}?${c.reset} ${question} `);
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await prompt(`${question} ${c.dim}${hint}${c.reset}`);
  if (answer.trim() === '') return defaultYes;
  return answer.trim().toLowerCase().startsWith('y');
}

export async function select(
  question: string,
  options: string[],
): Promise<number> {
  log(`${c.cyan}?${c.reset} ${question}`);
  for (let i = 0; i < options.length; i++) {
    log(`  ${c.dim}${i + 1}.${c.reset} ${options[i]}`);
  }
  const answer = await prompt(`${c.dim}Enter number (1-${options.length}):${c.reset}`);
  const num = parseInt(answer.trim(), 10);
  if (isNaN(num) || num < 1 || num > options.length) return 0;
  return num - 1;
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function detectFramework(
  root: string,
): 'nextjs-app' | 'nextjs-pages' | 'react' | 'unknown' {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return 'unknown';

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (deps.next) {
    // Check for app/ vs pages/ directory
    if (fs.existsSync(path.join(root, 'app'))) return 'nextjs-app';
    if (fs.existsSync(path.join(root, 'src', 'app'))) return 'nextjs-app';
    return 'nextjs-pages';
  }

  if (deps.react) return 'react';
  return 'unknown';
}
