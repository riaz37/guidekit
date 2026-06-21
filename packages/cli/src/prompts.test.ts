// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockQuestion = vi.fn<() => Promise<string>>();

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let logs: string[];

function captureConsole() {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
}

function restoreConsole() {
  vi.restoreAllMocks();
}

describe('prompts — fallback path (non-TTY)', () => {
  beforeEach(() => {
    captureConsole();
    mockQuestion.mockReset();
  });

  afterEach(() => {
    restoreConsole();
  });

  it('intro prints the title and subtitle', async () => {
    const { intro } = await import('./prompts.js');
    intro('GuideKit Setup', 'Detected: Next.js App Router');
    const output = logs.join('\n');
    expect(output).toContain('GuideKit Setup');
    expect(output).toContain('Detected: Next.js App Router');
  });

  it('outro prints the message', async () => {
    const { outro } = await import('./prompts.js');
    outro('Setup complete');
    const output = logs.join('\n');
    expect(output).toContain('Setup complete');
  });

  it('confirm returns true when the user answers yes', async () => {
    mockQuestion.mockResolvedValueOnce('y');
    const { confirm } = await import('./prompts.js');
    const result = await confirm('Continue?');
    expect(result).toBe(true);
  });

  it('confirm returns false when the user answers no', async () => {
    mockQuestion.mockResolvedValueOnce('n');
    const { confirm } = await import('./prompts.js');
    const result = await confirm('Continue?', { defaultValue: false });
    expect(result).toBe(false);
  });

  it('select returns the value at the chosen index', async () => {
    mockQuestion.mockResolvedValueOnce('2');
    const { select } = await import('./prompts.js');
    const result = await select('Pick a mode', [
      { value: 'text', label: 'Text' },
      { value: 'voice', label: 'Voice' },
      { value: 'platform', label: 'Platform' },
    ]);
    expect(result).toBe('voice');
  });

  it('select defaults to the first option on invalid input', async () => {
    mockQuestion.mockResolvedValueOnce('invalid');
    const { select } = await import('./prompts.js');
    const result = await select('Pick a mode', [
      { value: 'text', label: 'Text' },
      { value: 'voice', label: 'Voice' },
    ]);
    expect(result).toBe('text');
  });

  it('multiselect collects selected options', async () => {
    mockQuestion
      .mockResolvedValueOnce('y')
      .mockResolvedValueOnce('n')
      .mockResolvedValueOnce('y');
    const { multiselect } = await import('./prompts.js');
    const result = await multiselect('Enable features', [
      { value: 'voice', label: 'Voice' },
      { value: 'plugins', label: 'Plugins' },
      { value: 'knowledge', label: 'Knowledge' },
    ]);
    expect(result).toEqual(['voice', 'knowledge']);
  });

  it('text returns the entered value', async () => {
    mockQuestion.mockResolvedValueOnce('my-project');
    const { text } = await import('./prompts.js');
    const result = await text('Project name?');
    expect(result).toBe('my-project');
  });

  it('text uses the default value when input is empty', async () => {
    mockQuestion.mockResolvedValueOnce('');
    const { text } = await import('./prompts.js');
    const result = await text('Project name?', { defaultValue: 'guidekit-app' });
    expect(result).toBe('guidekit-app');
  });

  it('spinner logs and returns the task result', async () => {
    const { spinner } = await import('./prompts.js');
    const result = await spinner('Working', async () => 'done');
    expect(result).toBe('done');
    expect(logs.join('\n')).toContain('Working');
  });

  it('spinner rethrows task errors', async () => {
    const { spinner } = await import('./prompts.js');
    await expect(
      spinner('Working', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

describe('CancelError', () => {
  it('is identifiable with isCancel()', async () => {
    const { CancelError, isCancel } = await import('./prompts.js');
    const error = new CancelError();
    expect(isCancel(error)).toBe(true);
    expect(isCancel(new Error('other'))).toBe(false);
  });
});
