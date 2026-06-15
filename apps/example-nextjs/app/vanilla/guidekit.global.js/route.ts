import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function GET(): Promise<Response> {
  const filePath = resolve(process.cwd(), '../../packages/vanilla/dist/index.global.js');
  const js = await readFile(filePath, 'utf8');
  return new Response(js, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

