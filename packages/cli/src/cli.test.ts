// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Mocks — must be defined before imports that use them
// vi.hoisted() ensures mock fns are available when vi.mock() factories run
// ---------------------------------------------------------------------------

const { mockExistsSync, mockReadFileSync, mockWriteFileSync, mockMkdirSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(...args: unknown[]) => boolean>(() => false),
  mockReadFileSync: vi.fn<(...args: unknown[]) => string>(() => ''),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
}));

// Mock @guidekit/server
vi.mock('@guidekit/server', () => ({
  generateSecret: vi.fn(() => 'mock-secret-abcdefghijklmnopqrstuvwxyz123456'),
}));

// Mock both 'node:fs' (ESM imports) and 'fs' (CJS require('node:fs') resolution)
vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
  },
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
  },
}));

// Mock readline for interactive prompts
vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(async () => ''),
    close: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { generateSecret } from '@guidekit/server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let consoleLogs: string[];
let consoleErrors: string[];
const originalEnv = { ...process.env };

function captureConsole() {
  consoleLogs = [];
  consoleErrors = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    consoleLogs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
}

function restoreConsole() {
  vi.restoreAllMocks();
}

function allOutput(): string {
  return [...consoleLogs, ...consoleErrors].join('\n');
}

function resetFsMocks() {
  mockExistsSync.mockReset().mockReturnValue(false);
  mockReadFileSync.mockReset().mockReturnValue('');
  mockWriteFileSync.mockReset();
  mockMkdirSync.mockReset();
}

// ---------------------------------------------------------------------------
// Test Suite: run() — the main CLI entry point
// ---------------------------------------------------------------------------

describe('run() — CLI entry point', () => {
  beforeEach(() => {
    captureConsole();
    process.exitCode = undefined as unknown as number;
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('shows help when no arguments are provided', async () => {
    const { run } = await import('./cli.js');
    await run([]);
    const output = allOutput();
    expect(output).toContain('guidekit');
    expect(output).toContain('Commands');
    expect(output).toContain('init');
    expect(output).toContain('doctor');
    expect(output).toContain('generate-secret');
  });

  it('shows help with --help flag', async () => {
    const { run } = await import('./cli.js');
    await run(['--help']);
    const output = allOutput();
    expect(output).toContain('Commands');
    expect(output).toContain('Options');
  });

  it('shows help with -h flag', async () => {
    const { run } = await import('./cli.js');
    await run(['-h']);
    const output = allOutput();
    expect(output).toContain('Commands');
  });

  it('shows version with --version flag', async () => {
    const { run } = await import('./cli.js');
    await run(['--version']);
    const output = allOutput();
    expect(output).toContain('0.1.0');
  });

  it('shows version with -v flag', async () => {
    const { run } = await import('./cli.js');
    await run(['-v']);
    const output = allOutput();
    expect(output).toContain('0.1.0');
  });

  it('sets exitCode=1 for unknown commands', async () => {
    const { run } = await import('./cli.js');
    await run(['nonexistent-command']);
    expect(process.exitCode).toBe(1);
    const output = allOutput();
    expect(output).toContain('Unknown command');
    expect(output).toContain('nonexistent-command');
  });

  it('suggests --help for unknown commands', async () => {
    const { run } = await import('./cli.js');
    await run(['foobar']);
    const output = allOutput();
    expect(output).toContain('--help');
  });

  it('help output includes documentation link', async () => {
    const { run } = await import('./cli.js');
    await run(['--help']);
    const output = allOutput();
    expect(output).toContain('https://guidekit.dev/docs/cli');
  });

  it('help output includes examples section', async () => {
    const { run } = await import('./cli.js');
    await run(['--help']);
    const output = allOutput();
    expect(output).toContain('Examples');
    expect(output).toContain('npx guidekit init');
    expect(output).toContain('npx guidekit doctor');
    expect(output).toContain('npx guidekit generate-secret');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: utils — colors, log helpers, file utilities
// ---------------------------------------------------------------------------

describe('utils — color constants', () => {
  it('exports c object with expected color keys', async () => {
    const { c } = await import('./utils.js');
    expect(c).toHaveProperty('reset');
    expect(c).toHaveProperty('bold');
    expect(c).toHaveProperty('dim');
    expect(c).toHaveProperty('red');
    expect(c).toHaveProperty('green');
    expect(c).toHaveProperty('yellow');
    expect(c).toHaveProperty('blue');
    expect(c).toHaveProperty('cyan');
  });

  it('all color values are strings', async () => {
    const { c } = await import('./utils.js');
    for (const value of Object.values(c)) {
      expect(typeof value).toBe('string');
    }
  });
});

describe('utils — log helpers', () => {
  beforeEach(() => {
    captureConsole();
  });

  afterEach(() => {
    restoreConsole();
  });

  it('log() writes to console.log', async () => {
    const { log } = await import('./utils.js');
    log('hello world');
    expect(consoleLogs).toContain('hello world');
  });

  it('success() writes with green checkmark', async () => {
    const { success } = await import('./utils.js');
    success('it works');
    const output = consoleLogs.join('\n');
    expect(output).toContain('it works');
  });

  it('warn() writes with yellow marker', async () => {
    const { warn } = await import('./utils.js');
    warn('be careful');
    const output = consoleLogs.join('\n');
    expect(output).toContain('be careful');
  });

  it('error() writes to console.error', async () => {
    const { error } = await import('./utils.js');
    error('something failed');
    const output = consoleErrors.join('\n');
    expect(output).toContain('something failed');
  });

  it('info() writes with info marker', async () => {
    const { info } = await import('./utils.js');
    info('some info');
    const output = consoleLogs.join('\n');
    expect(output).toContain('some info');
  });

  it('heading() wraps in bold', async () => {
    const { heading } = await import('./utils.js');
    heading('My Section');
    const output = consoleLogs.join('\n');
    expect(output).toContain('My Section');
  });
});

describe('utils — fileExists()', () => {
  beforeEach(() => {
    resetFsMocks();
  });

  it('returns true when file exists', async () => {
    mockExistsSync.mockReturnValue(true);
    const { fileExists } = await import('./utils.js');
    expect(fileExists('/some/path')).toBe(true);
    expect(mockExistsSync).toHaveBeenCalledWith('/some/path');
  });

  it('returns false when file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const { fileExists } = await import('./utils.js');
    expect(fileExists('/missing/file')).toBe(false);
  });
});

describe('utils — findProjectRoot()', () => {
  beforeEach(() => {
    resetFsMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns directory containing package.json', async () => {
    const cwd = '/home/user/project/packages/cli';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    mockExistsSync.mockImplementation((p) => {
      return p === path.join('/home/user/project', 'package.json');
    });

    const { findProjectRoot } = await import('./utils.js');
    expect(findProjectRoot()).toBe('/home/user/project');
  });

  it('returns cwd when no package.json is found', async () => {
    const cwd = '/tmp/no-project';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    mockExistsSync.mockReturnValue(false);

    const { findProjectRoot } = await import('./utils.js');
    expect(findProjectRoot()).toBe(cwd);
  });

  it('returns cwd itself if package.json is in cwd', async () => {
    const cwd = '/home/user/project';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    mockExistsSync.mockImplementation((p) => {
      return p === path.join(cwd, 'package.json');
    });

    const { findProjectRoot } = await import('./utils.js');
    expect(findProjectRoot()).toBe(cwd);
  });
});

describe('utils — detectFramework()', () => {
  beforeEach(() => {
    resetFsMocks();
  });

  it('returns "unknown" when no package.json exists', async () => {
    mockExistsSync.mockReturnValue(false);
    const { detectFramework } = await import('./utils.js');
    expect(detectFramework('/root')).toBe('unknown');
  });

  it('detects nextjs-app when next dep and app/ dir exist', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('package.json')) return true;
      if (s === path.join('/root', 'app')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
    );

    const { detectFramework } = await import('./utils.js');
    expect(detectFramework('/root')).toBe('nextjs-app');
  });

  it('detects nextjs-app when next dep and src/app/ dir exist', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('package.json')) return true;
      if (s === path.join('/root', 'src', 'app')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
    );

    const { detectFramework } = await import('./utils.js');
    expect(detectFramework('/root')).toBe('nextjs-app');
  });

  it('detects nextjs-pages when next dep but no app/ directory', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
    );

    const { detectFramework } = await import('./utils.js');
    expect(detectFramework('/root')).toBe('nextjs-pages');
  });

  it('detects react when react dep exists but no next', async () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).endsWith('package.json');
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    );

    const { detectFramework } = await import('./utils.js');
    expect(detectFramework('/root')).toBe('react');
  });

  it('returns "unknown" when no recognized framework deps found', async () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).endsWith('package.json');
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    );

    const { detectFramework } = await import('./utils.js');
    expect(detectFramework('/root')).toBe('unknown');
  });

  it('detects next in devDependencies too', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('package.json')) return true;
      if (s === path.join('/root', 'app')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ devDependencies: { next: '^14.0.0' } }),
    );

    const { detectFramework } = await import('./utils.js');
    expect(detectFramework('/root')).toBe('nextjs-app');
  });

  it('handles package.json with no dependencies or devDependencies', async () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).endsWith('package.json');
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'test' }));

    const { detectFramework } = await import('./utils.js');
    expect(detectFramework('/root')).toBe('unknown');
  });
});

describe('utils — writeFile()', () => {
  beforeEach(() => {
    resetFsMocks();
  });

  it('creates parent directory when it does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const { writeFile } = await import('./utils.js');
    writeFile('/a/b/c/file.txt', 'content');
    expect(mockMkdirSync).toHaveBeenCalledWith('/a/b/c', { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith('/a/b/c/file.txt', 'content', 'utf-8');
  });

  it('writes to file when parent directory already exists', async () => {
    mockExistsSync.mockReturnValue(true);
    const { writeFile } = await import('./utils.js');
    writeFile('/a/b/file.txt', 'data');
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledWith('/a/b/file.txt', 'data', 'utf-8');
  });
});

describe('utils — readFile()', () => {
  beforeEach(() => {
    resetFsMocks();
  });

  it('reads file contents', async () => {
    mockReadFileSync.mockReturnValue('file content here');
    const { readFile } = await import('./utils.js');
    expect(readFile('/some/file.txt')).toBe('file content here');
    expect(mockReadFileSync).toHaveBeenCalledWith('/some/file.txt', 'utf-8');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: generate-secret command
// ---------------------------------------------------------------------------

describe('generate-secret command', () => {
  beforeEach(() => {
    captureConsole();
    vi.mocked(generateSecret).mockClear();
  });

  afterEach(() => {
    restoreConsole();
  });

  it('calls generateSecret from @guidekit/server', async () => {
    const { runGenerateSecret } = await import('./commands/generate-secret.js');
    await runGenerateSecret();
    expect(generateSecret).toHaveBeenCalledOnce();
  });

  it('outputs the generated secret', async () => {
    const { runGenerateSecret } = await import('./commands/generate-secret.js');
    await runGenerateSecret();
    const output = allOutput();
    expect(output).toContain('mock-secret-abcdefghijklmnopqrstuvwxyz123456');
  });

  it('outputs heading', async () => {
    const { runGenerateSecret } = await import('./commands/generate-secret.js');
    await runGenerateSecret();
    const output = allOutput();
    expect(output).toContain('Generate Signing Secret');
  });

  it('shows .env instructions', async () => {
    const { runGenerateSecret } = await import('./commands/generate-secret.js');
    await runGenerateSecret();
    const output = allOutput();
    expect(output).toContain('GUIDEKIT_SECRET=');
    expect(output).toContain('.env');
  });

  it('shows warning about version control', async () => {
    const { runGenerateSecret } = await import('./commands/generate-secret.js');
    await runGenerateSecret();
    const output = allOutput();
    expect(output).toContain('Warning');
    expect(output).toContain('version control');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: doctor command — individual checks
// ---------------------------------------------------------------------------

describe('doctor — checkEnvFile', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('reports ok when .env.local exists', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join('/project', 'package.json')) return true;
      if (s === path.join('/project', '.env.local')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { '@guidekit/core': '1.0', '@guidekit/react': '1.0', '@guidekit/server': '1.0' } }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    process.env.GUIDEKIT_SECRET = 'a'.repeat(32);
    process.env.LLM_API_KEY = 'AIxxxxxxxxxxxxxxxxxxxxxxx';

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Found .env.local');
  });

  it('reports ok when .env exists (but not .env.local)', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join('/project', 'package.json')) return true;
      if (s === path.join('/project', '.env')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: {} }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Found .env');
  });

  it('reports warning when no .env file exists', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: {} }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('No .env or .env.local found');
  });
});

describe('doctor — checkGuidekitSecret', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('reports ok when GUIDEKIT_SECRET is valid length', async () => {
    process.env.GUIDEKIT_SECRET = 'a'.repeat(32);
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Set and valid length');
  });

  it('reports warning when GUIDEKIT_SECRET is not set', async () => {
    delete process.env.GUIDEKIT_SECRET;
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Not set');
    expect(output).toContain('generate-secret');
  });

  it('reports error when GUIDEKIT_SECRET is too short', async () => {
    process.env.GUIDEKIT_SECRET = 'short';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('too short');
  });
});

describe('doctor — checkLlmApiKey', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('reports ok when LLM_API_KEY is set', async () => {
    process.env.LLM_API_KEY = 'AIabcdefghijklmnopqrstuvwxyz';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toMatch(/LLM.*Found/s);
  });

  it('reports ok when GEMINI_KEY is set as fallback', async () => {
    delete process.env.LLM_API_KEY;
    process.env.GEMINI_KEY = 'AIabcdefghijklmnopqrstuvwxyz';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toMatch(/LLM.*Found/s);
  });

  it('reports ok when GEMINI_API_KEY is set as fallback', async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.GEMINI_KEY;
    process.env.GEMINI_API_KEY = 'AIabcdefghijklmnopqrstuvwxyz';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toMatch(/LLM.*Found/s);
  });

  it('reports ok when GOOGLE_AI_KEY is set as fallback', async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.GEMINI_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_AI_KEY = 'AIabcdefghijklmnopqrstuvwxyz';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toMatch(/LLM.*Found/s);
  });

  it('reports warning when no LLM key is set', async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.GEMINI_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_KEY;
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Not found');
    expect(output).toContain('LLM_API_KEY');
  });
});

describe('doctor — checkSttApiKey', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('reports ok when STT_API_KEY is set', async () => {
    process.env.STT_API_KEY = 'some-stt-key';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toMatch(/STT API Key.*Found/s);
  });

  it('reports ok when DEEPGRAM_KEY is set as fallback', async () => {
    delete process.env.STT_API_KEY;
    process.env.DEEPGRAM_KEY = 'some-deepgram-key';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toMatch(/STT API Key.*Found/s);
  });

  it('reports ok when DEEPGRAM_API_KEY is set as fallback', async () => {
    delete process.env.STT_API_KEY;
    delete process.env.DEEPGRAM_KEY;
    process.env.DEEPGRAM_API_KEY = 'some-deepgram-api-key';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toMatch(/STT API Key.*Found/s);
  });

  it('reports skip when no STT key is set', async () => {
    delete process.env.STT_API_KEY;
    delete process.env.DEEPGRAM_KEY;
    delete process.env.DEEPGRAM_API_KEY;
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('optional');
  });
});

describe('doctor — checkTtsApiKey', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('reports ok when TTS_API_KEY is set', async () => {
    process.env.TTS_API_KEY = 'some-tts-key';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toMatch(/TTS API Key.*Found/s);
  });

  it('reports ok when ELEVENLABS_KEY is set as fallback', async () => {
    delete process.env.TTS_API_KEY;
    process.env.ELEVENLABS_KEY = 'some-elevenlabs-key';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toMatch(/TTS API Key.*Found/s);
  });

  it('reports ok when ELEVENLABS_API_KEY is set as fallback', async () => {
    delete process.env.TTS_API_KEY;
    delete process.env.ELEVENLABS_KEY;
    process.env.ELEVENLABS_API_KEY = 'some-elevenlabs-api-key';
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toMatch(/TTS API Key.*Found/s);
  });

  it('reports skip when no TTS key is set', async () => {
    delete process.env.TTS_API_KEY;
    delete process.env.ELEVENLABS_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('optional');
  });
});

describe('doctor — checkGitignore', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('reports ok when .gitignore contains .env', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join('/project', 'package.json')) return true;
      if (s === path.join('/project', '.gitignore')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('.gitignore')) return '.env\nnode_modules\n';
      return JSON.stringify({ dependencies: {} });
    });

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('.env files are ignored');
  });

  it('reports warning when .gitignore does not contain .env', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join('/project', 'package.json')) return true;
      if (s === path.join('/project', '.gitignore')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('.gitignore')) return 'node_modules\n';
      return JSON.stringify({ dependencies: {} });
    });

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('not in .gitignore');
  });

  it('reports warning when .gitignore does not exist', async () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('No .gitignore found');
  });
});

describe('doctor — checkPackageInstalled', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('reports ok when package is installed', async () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        dependencies: {
          '@guidekit/core': '^1.0.0',
          '@guidekit/react': '^1.0.0',
          '@guidekit/server': '^1.0.0',
        },
      }),
    );

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Installed');
  });

  it('reports error when package is not installed', async () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: {} }),
    );

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Not installed');
  });

  it('reports error when no package.json found', async () => {
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('No package.json found');
  });
});

describe('doctor — connectivity checks', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('reports ok when provider is reachable (200)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Reachable');
  });

  it('reports ok for 401/403/405 responses (endpoint reachable but auth needed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Reachable');
  });

  it('reports ok for 403 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Reachable');
  });

  it('reports warning for unexpected HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('HTTP 500');
  });

  it('reports error on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Network error');
  });

  it('reports timeout error on abort', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('The operation was aborted')));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Timeout');
  });
});

describe('doctor — summary output', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('prints error count when errors are found', async () => {
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('error');
  });

  it('prints all checks passed when everything is green', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join('/project', 'package.json')) return true;
      if (s === path.join('/project', '.env.local')) return true;
      if (s === path.join('/project', '.gitignore')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('.gitignore')) return '.env\nnode_modules\n';
      return JSON.stringify({
        dependencies: {
          '@guidekit/core': '^1.0.0',
          '@guidekit/react': '^1.0.0',
          '@guidekit/server': '^1.0.0',
        },
      });
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    process.env.GUIDEKIT_SECRET = 'a'.repeat(32);
    process.env.LLM_API_KEY = 'AIabcdefghijklmnopqrstuvwxyz';

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('All checks passed');
  });

  it('shows Results heading', async () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Results');
  });

  it('shows project root info', async () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('Project root');
  });

  it('shows warning summary when only warnings exist', async () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        dependencies: {
          '@guidekit/core': '^1.0.0',
          '@guidekit/react': '^1.0.0',
          '@guidekit/server': '^1.0.0',
        },
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    delete process.env.GUIDEKIT_SECRET;
    delete process.env.LLM_API_KEY;
    delete process.env.GEMINI_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_KEY;

    const { runDoctor } = await import('./commands/doctor.js');
    await runDoctor();
    const output = allOutput();
    expect(output).toContain('warning');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: init command — template generation and framework detection
// ---------------------------------------------------------------------------

describe('init — template generation', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('shows heading and detected framework', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    );

    const { createInterface } = await import('node:readline/promises');
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn()
        .mockResolvedValueOnce('1')
        .mockResolvedValueOnce('n')
        .mockResolvedValueOnce('n') as ReturnType<typeof vi.fn>,
      close: vi.fn(),
    } as unknown as ReturnType<typeof createInterface>);

    const { runInit } = await import('./commands/init.js');
    await runInit();
    const output = allOutput();
    expect(output).toContain('GuideKit');
    expect(output).toContain('Project root');
    expect(output).toContain('react');
  });

  it('detects missing packages and suggests install command', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    );

    const { createInterface } = await import('node:readline/promises');
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn()
        .mockResolvedValueOnce('1')
        .mockResolvedValueOnce('n')
        .mockResolvedValueOnce('n') as ReturnType<typeof vi.fn>,
      close: vi.fn(),
    } as unknown as ReturnType<typeof createInterface>);

    const { runInit } = await import('./commands/init.js');
    await runInit();
    const output = allOutput();
    expect(output).toContain('Missing packages');
    expect(output).toContain('@guidekit/core');
    expect(output).toContain('npm install');
  });

  it('reports all packages installed when they exist', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        dependencies: {
          react: '^18.0.0',
          '@guidekit/core': '^1.0.0',
          '@guidekit/react': '^1.0.0',
          '@guidekit/server': '^1.0.0',
        },
      }),
    );

    const { createInterface } = await import('node:readline/promises');
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn()
        .mockResolvedValueOnce('1')
        .mockResolvedValueOnce('n')
        .mockResolvedValueOnce('n') as ReturnType<typeof vi.fn>,
      close: vi.fn(),
    } as unknown as ReturnType<typeof createInterface>);

    const { runInit } = await import('./commands/init.js');
    await runInit();
    const output = allOutput();
    expect(output).toContain('All GuideKit packages are installed');
  });

  it('shows next steps at the end', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    );

    const { createInterface } = await import('node:readline/promises');
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn()
        .mockResolvedValueOnce('1')
        .mockResolvedValueOnce('n')
        .mockResolvedValueOnce('n') as ReturnType<typeof vi.fn>,
      close: vi.fn(),
    } as unknown as ReturnType<typeof createInterface>);

    const { runInit } = await import('./commands/init.js');
    await runInit();
    const output = allOutput();
    expect(output).toContain('Next steps');
    expect(output).toContain('generate-secret');
    expect(output).toContain('GuideKitProvider');
    expect(output).toContain('Setup complete');
  });

  it('mentions env.local when providing next steps', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: {} }),
    );

    const { createInterface } = await import('node:readline/promises');
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn()
        .mockResolvedValueOnce('1')
        .mockResolvedValueOnce('n')
        .mockResolvedValueOnce('n') as ReturnType<typeof vi.fn>,
      close: vi.fn(),
    } as unknown as ReturnType<typeof createInterface>);

    const { runInit } = await import('./commands/init.js');
    await runInit();
    const output = allOutput();
    expect(output).toContain('.env.local');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: run() dispatches to correct commands
// ---------------------------------------------------------------------------

describe('run() — command dispatching', () => {
  beforeEach(() => {
    captureConsole();
    resetFsMocks();
  });

  afterEach(() => {
    restoreConsole();
    process.env = { ...originalEnv };
  });

  it('dispatches to generate-secret command', async () => {
    const { run } = await import('./cli.js');
    await run(['generate-secret']);
    const output = allOutput();
    expect(output).toContain('Generate Signing Secret');
  });

  it('dispatches to doctor command', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join('/project', 'package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { run } = await import('./cli.js');
    await run(['doctor']);
    const output = allOutput();
    expect(output).toContain('GuideKit Doctor');
  });
});
