#!/usr/bin/env node
/**
 * Generate llms.txt agent index for the GuideKit monorepo.
 * Usage: node scripts/generate-llms-txt.mjs
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const STATIC_SECTIONS = `# GuideKit

> AI-powered user guidance SDK — DOM intelligence, LLM orchestration, voice, and visual guidance for web apps.

GuideKit is a pnpm + Turborepo monorepo. Published packages live under \`packages/\`. Integration docs and examples live under \`apps/\`.

## Agent entry points

- [AGENTS.md](AGENTS.md): Agent onboarding, architecture rules, validation checklist
- [skills/guidekit/SKILL.md](skills/guidekit/SKILL.md): Monorepo skill for AI agents
- [Architecture docs](apps/docs/app/docs/architecture/page.mdx): Public SDK architecture
- [CONTRIBUTING.md](CONTRIBUTING.md): Setup, testing, changesets

## Core packages

`;

async function readDescription(packageJsonPath) {
  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    return pkg.description ?? '';
  } catch {
    return '';
  }
}

async function listDocsPages() {
  const docsRoot = join(ROOT, 'apps/docs/app/docs');
  const pages = [];

  async function walk(dir, prefix = '') {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.name.endsWith('.mdx')) {
        const slug = rel.replace(/\/page\.mdx$/, '').replace(/\.mdx$/, '');
        pages.push(slug === 'page' ? prefix : slug.replace(/\/page$/, ''));
      }
    }
  }

  await walk(docsRoot);
  return [...new Set(pages)].sort();
}

async function main() {
  const packagesDir = join(ROOT, 'packages');
  const names = (await readdir(packagesDir)).sort();

  let body = STATIC_SECTIONS;

  for (const name of names) {
    const pkgPath = join(packagesDir, name, 'package.json');
    const desc = await readDescription(pkgPath);
    body += `- [@guidekit/${name}](packages/${name}/README.md): ${desc}\n`;
  }

  body += `\n## Apps\n\n`;
  body += `- [apps/docs](apps/docs/): Documentation site (Nextra)\n`;
  body += `- [apps/example-nextjs](apps/example-nextjs/): Reference Next.js integration\n`;

  body += `\n## Docs pages\n\n`;
  const pages = await listDocsPages();
  for (const page of pages) {
    body += `- [${page}](apps/docs/app/docs/${page}/page.mdx)\n`;
  }

  body += `\n## Scripts\n\n`;
  body += `- \`pnpm skills:sync\` — link skills for agent discovery\n`;
  body += `- \`pnpm check\` — build, typecheck, lint, test\n`;
  body += `- \`pnpm stats\` — package LOC report\n`;
  body += `- \`pnpm llms:generate\` — regenerate this file\n`;

  const outPath = join(ROOT, 'llms.txt');
  await writeFile(outPath, body, 'utf8');
  console.log(`Wrote ${outPath} (${body.split('\n').length} lines)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
