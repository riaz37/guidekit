import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());

const PACKAGES = [
  'core',
  'react',
  'server',
  'intelligence',
  'knowledge',
  'plugins',
  'vanilla',
  'vad',
  'cli',
];

function fail(msg) {
  console.error(`verify-published-packages: ${msg}`);
  process.exit(1);
}

for (const name of PACKAGES) {
  const pkgDir = resolve(ROOT, 'packages', name);
  const pkgJsonPath = resolve(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) fail(`Missing package.json for packages/${name}`);

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const distDir = resolve(pkgDir, 'dist');
  if (!existsSync(distDir)) fail(`Missing dist/ for packages/${name} (run pnpm build)`);

  const files = pkgJson.files ?? [];
  if (!Array.isArray(files) || !files.includes('dist')) {
    fail(`packages/${name}/package.json should include \"dist\" in files[]`);
  }

  const srcDir = resolve(pkgDir, 'src');
  if (!existsSync(srcDir)) fail(`Missing src/ for packages/${name}`);
  const srcFiles = readdirSync(srcDir, { recursive: true }).map(String);
  const hasTests = srcFiles.some((p) => p.endsWith('.test.ts') || p.endsWith('.test.tsx'));
  if (!hasTests) fail(`packages/${name} has no *.test.ts(x) under src/`);
}

console.log('verify-published-packages: OK');

