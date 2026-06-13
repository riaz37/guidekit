#!/usr/bin/env node
/**
 * Report package source LOC and core facade size.
 * Usage: node scripts/package-stats.mjs
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mdx']);

async function walk(dir, files = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') {
        continue;
      }
      await walk(full, files);
    } else if (SRC_EXT.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) {
        continue;
      }
      files.push(full);
    }
  }
  return files;
}

async function countLines(filePath) {
  const content = await readFile(filePath, 'utf8');
  return content.split('\n').length;
}

async function packageStats(pkgDir) {
  const srcDir = join(pkgDir, 'src');
  const srcStat = await stat(srcDir).catch(() => null);
  if (!srcStat?.isDirectory()) {
    return null;
  }
  const files = await walk(srcDir);
  let lines = 0;
  for (const file of files) {
    lines += await countLines(file);
  }
  return { files: files.length, lines };
}

async function main() {
  const packagesDir = join(ROOT, 'packages');
  const packages = (await readdir(packagesDir)).sort();

  console.log('GuideKit package stats (src only, excludes tests)\n');
  console.log('Package'.padEnd(22) + 'Files'.padStart(8) + 'Lines'.padStart(10));
  console.log('-'.repeat(40));

  let totalLines = 0;
  for (const name of packages) {
    const stats = await packageStats(join(packagesDir, name));
    if (!stats) continue;
    totalLines += stats.lines;
    console.log(
      `@guidekit/${name}`.padEnd(22) +
        String(stats.files).padStart(8) +
        String(stats.lines).padStart(10),
    );
  }

  console.log('-'.repeat(40));
  console.log('TOTAL'.padEnd(22) + ''.padStart(8) + String(totalLines).padStart(10));

  const coreFacade = join(ROOT, 'packages/core/src/core.ts');
  const facadeLines = await countLines(coreFacade);
  const target = 400;
  const status = facadeLines <= target + 50 ? 'ok' : 'WARN';
  console.log(`\ncore.ts facade: ${facadeLines} lines (target ~${target}) [${status}]`);
  console.log(`  ${relative(ROOT, coreFacade)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
