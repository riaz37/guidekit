import { execSync } from 'node:child_process';
import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

function dependencyEntries(pkgJson) {
  const sections = [
    pkgJson.dependencies,
    pkgJson.devDependencies,
    pkgJson.peerDependencies,
    pkgJson.optionalDependencies,
  ];
  return sections
    .filter(Boolean)
    .flatMap((section) => Object.entries(section));
}

function findWorkspaceProtocolDeps(entries) {
  return entries.filter(([, version]) => String(version).startsWith('workspace:'));
}

function readPackedPackageJson(pkgDir) {
  const packDir = mkdtempSync(join(tmpdir(), 'guidekit-pack-'));
  try {
    execSync(`pnpm pack --pack-destination "${packDir}"`, {
      cwd: pkgDir,
      stdio: 'pipe',
    });

    const tarball = readdirSync(packDir).find((file) => file.endsWith('.tgz'));
    if (!tarball) {
      fail(`pnpm pack produced no tarball in ${packDir}`);
    }

    return JSON.parse(
      execSync(`tar -xOzf "${join(packDir, tarball)}" package/package.json`, {
        encoding: 'utf8',
      }),
    );
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
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
    fail(`packages/${name}/package.json should include "dist" in files[]`);
  }

  const srcDir = resolve(pkgDir, 'src');
  if (!existsSync(srcDir)) fail(`Missing src/ for packages/${name}`);
  const srcFiles = readdirSync(srcDir, { recursive: true }).map(String);
  const hasTests = srcFiles.some((p) => p.endsWith('.test.ts') || p.endsWith('.test.tsx'));
  if (!hasTests) fail(`packages/${name} has no *.test.ts(x) under src/`);

  const packedJson = readPackedPackageJson(pkgDir);
  const workspaceDeps = findWorkspaceProtocolDeps(dependencyEntries(packedJson));
  if (workspaceDeps.length > 0) {
    const details = workspaceDeps.map(([dep, version]) => `${dep}@${version}`).join(', ');
    fail(
      `packages/${name} tarball still contains workspace: deps (${details}). ` +
        'Use pnpm publish (not npm publish) so workspace:^ is rewritten to semver.',
    );
  }
}

console.log('verify-published-packages: OK');
