// ---------------------------------------------------------------------------
// Interactive prompt abstraction for @guidekit/cli
// ---------------------------------------------------------------------------
// Uses `prompts` for TTY environments and falls back to readline-based helpers
// in CI, non-TTY, or when NO_COLOR is set.
// ---------------------------------------------------------------------------

import prompts from 'prompts';
import {
  c,
  prompt as readlinePrompt,
  confirm as readlineConfirm,
  select as readlineSelect,
} from './utils.js';

export class CancelError extends Error {
  constructor() {
    super('Cancelled by user');
  }
}

export function isCancel(error: unknown): error is CancelError {
  return error instanceof CancelError;
}

export type SelectOption<T> = {
  value: T;
  label: string;
  hint?: string;
};

export type TextOptions = {
  defaultValue?: string;
  placeholder?: string;
  validate?: (value: string) => string | undefined | Promise<string | undefined>;
};

export type ConfirmOptions = {
  defaultValue?: boolean;
};

function shouldUseFallback(): boolean {
  return (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    process.env.CI === 'true' ||
    process.env.NO_COLOR === 'true'
  );
}

export function intro(title: string, subtitle?: string): void {
  log('');
  log(`${c.bold}${title}${c.reset}`);
  if (subtitle) {
    log(subtitle);
  }
  log('');
}

export function outro(message: string): void {
  log('');
  log(`${c.bold}${message}${c.reset}`);
  log('');
}

export async function confirm(
  message: string,
  options: ConfirmOptions = {},
): Promise<boolean> {
  if (shouldUseFallback()) {
    return readlineConfirm(message, options.defaultValue ?? true);
  }

  const response = await prompts(
    {
      type: 'confirm',
      name: 'value',
      message,
      initial: options.defaultValue ?? true,
    },
    {
      onCancel: () => {
        throw new CancelError();
      },
    },
  );

  return response.value as boolean;
}

export async function select<T>(
  message: string,
  options: SelectOption<T>[],
): Promise<T> {
  if (options.length === 0) {
    throw new Error('select() requires at least one option');
  }

  if (shouldUseFallback()) {
    const index = await readlineSelect(
      message,
      options.map((option) => option.label),
    );
    return options[index]?.value as T;
  }

  const response = await prompts(
    {
      type: 'select',
      name: 'value',
      message,
      choices: options.map((option) => ({
        title: option.label,
        value: option.value,
        description: option.hint,
      })),
      initial: 0,
    },
    {
      onCancel: () => {
        throw new CancelError();
      },
    },
  );

  return response.value as T;
}

export async function multiselect<T>(
  message: string,
  options: SelectOption<T>[],
): Promise<T[]> {
  if (shouldUseFallback()) {
    const selected: T[] = [];
    for (const option of options) {
      const yes = await readlineConfirm(`Include ${option.label}?`, false);
      if (yes) {
        selected.push(option.value);
      }
    }
    return selected;
  }

  const response = await prompts(
    {
      type: 'multiselect',
      name: 'value',
      message,
      choices: options.map((option) => ({
        title: option.label,
        value: option.value,
        description: option.hint,
      })),
      instructions: false,
      hint: '- Space to select. Return to submit',
    },
    {
      onCancel: () => {
        throw new CancelError();
      },
    },
  );

  return (response.value as T[]) ?? [];
}

export async function text(
  message: string,
  options: TextOptions = {},
): Promise<string> {
  if (shouldUseFallback()) {
    const answer = await readlinePrompt(message);
    const value = answer.trim() || (options.defaultValue ?? '');
    if (options.validate) {
      const error = await options.validate(value);
      if (error) {
        throw new Error(error);
      }
    }
    return value;
  }

  const response = await prompts(
    {
      type: 'text',
      name: 'value',
      message,
      initial: options.defaultValue,
      validate: options.validate
        ? async (value) => {
            const error = await options.validate!(value);
            return error ? error : true;
          }
        : undefined,
    },
    {
      onCancel: () => {
        throw new CancelError();
      },
    },
  );

  return response.value as string;
}

export async function spinner<T>(
  label: string,
  task: () => Promise<T>,
): Promise<T> {
  if (shouldUseFallback()) {
    log(`${c.dim}->${c.reset} ${label}`);
    return task();
  }

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;

  const interval = setInterval(() => {
    process.stdout.write(`\r${c.dim}${frames[frameIndex]}${c.reset} ${label}`);
    frameIndex = (frameIndex + 1) % frames.length;
  }, 80);

  function clearLine(message: string): void {
    const padding = Math.max(0, process.stdout.columns - message.length - 1);
    process.stdout.write(`\r${message}${' '.repeat(padding)}\n`);
  }

  try {
    const result = await task();
    clearInterval(interval);
    clearLine(`${c.green}✓${c.reset} ${label}`);
    return result;
  } catch (error) {
    clearInterval(interval);
    clearLine(`${c.red}✗${c.reset} ${label}`);
    throw error;
  }
}

function log(message: string): void {
  console.log(message);
}
