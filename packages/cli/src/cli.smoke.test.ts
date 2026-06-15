// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function runCli(args: string[], cwd?: string) {
  const cliPath = resolve(process.cwd(), 'packages/cli/dist/cli.js');
  expect(existsSync(cliPath), `Missing built CLI at ${cliPath}. Run pnpm build first.`).toBe(true);

  const res = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: cwd ?? process.cwd(),
    env: {
      ...process.env,
      GUIDEKIT_SECRET: process.env.GUIDEKIT_SECRET ?? 'guidekit-example-e2e-secret-32-chars',
      LLM_API_KEY: process.env.LLM_API_KEY ?? 'e2e-dummy-llm-key-for-contract-tests',
    },
    encoding: 'utf8',
  });

  return {
    code: res.status ?? 0,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

describe('@guidekit/cli — subprocess smoke', () => {
  it('prints help', () => {
    const { code, stdout } = runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('init');
    expect(stdout).toContain('doctor');
    expect(stdout).toContain('generate-secret');
  });

  it('generate-secret outputs a secret', () => {
    const { code, stdout } = runCli(['generate-secret']);
    expect(code).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(20);
  });

  it('doctor runs in example app directory', () => {
    const { code, stdout } = runCli(['doctor'], resolve(process.cwd(), 'apps/example-nextjs'));
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain('doctor');
  }, 15_000);
});

