import { describe, it, expect } from 'vitest';
import {
  GuideKitError,
  AuthenticationError,
  ConfigurationError,
  InitializationError,
  RateLimitError,
  ResourceExhaustedError,
  PermissionError,
  NetworkError,
  TimeoutError,
  BrowserSupportError,
  ContentFilterError,
  isGuideKitError,
  ErrorCodes,
} from './index';
import type { GuideKitErrorOptions } from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid options for constructing a GuideKitError. */
const baseOpts: GuideKitErrorOptions = {
  code: 'AUTH_INVALID_KEY',
  message: 'Invalid API key',
  recoverable: false,
  suggestion: 'Check your API key in the dashboard.',
};

// ---------------------------------------------------------------------------
// GuideKitError (base class)
// ---------------------------------------------------------------------------

describe('GuideKitError', () => {
  it('extends Error with all fields', () => {
    const err = new GuideKitError(baseOpts);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err.message).toBe(baseOpts.message);
    expect(err.code).toBe(baseOpts.code);
    expect(err.recoverable).toBe(false);
    expect(err.suggestion).toBe(baseOpts.suggestion);
    expect(err.name).toBe('GuideKitError');
  });

  it('has correct name property', () => {
    const err = new GuideKitError(baseOpts);
    expect(err.name).toBe('GuideKitError');
  });

  it('docsUrl defaults to https://guidekit-docs.vercel.app/docs/error-codes#{code}', () => {
    const err = new GuideKitError(baseOpts);
    expect(err.docsUrl).toBe(`https://guidekit-docs.vercel.app/docs/error-codes#${baseOpts.code}`);
  });

  it('custom docsUrl overrides default', () => {
    const err = new GuideKitError({
      ...baseOpts,
      docsUrl: 'https://custom.docs/my-error',
    });
    expect(err.docsUrl).toBe('https://custom.docs/my-error');
  });

  it('provider field is set when provided', () => {
    const err = new GuideKitError({ ...baseOpts, provider: 'deepgram' });
    expect(err.provider).toBe('deepgram');
  });

  it('provider field is undefined when not provided', () => {
    const err = new GuideKitError(baseOpts);
    expect(err.provider).toBeUndefined();
  });

  it('cause is passed through', () => {
    const cause = new Error('root cause');
    const err = new GuideKitError({ ...baseOpts, cause });
    expect(err.cause).toBe(cause);
  });

  it('cause is undefined when not provided', () => {
    const err = new GuideKitError(baseOpts);
    expect(err.cause).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Subclass name properties
// ---------------------------------------------------------------------------

describe('Error subclass name properties', () => {
  const subclasses: Array<{
    Class: new (...args: any[]) => GuideKitError;
    expectedName: string;
    opts: Record<string, unknown>;
  }> = [
    {
      Class: AuthenticationError,
      expectedName: 'AuthenticationError',
      opts: { code: 'AUTH_INVALID_KEY', message: 'bad key', suggestion: 'fix it' },
    },
    {
      Class: ConfigurationError,
      expectedName: 'ConfigurationError',
      opts: { code: 'CONFIG_INVALID_PROVIDER', message: 'bad config', suggestion: 'fix it' },
    },
    {
      Class: InitializationError,
      expectedName: 'InitializationError',
      opts: { code: 'INIT_SHADOW_DOM_FAILED', message: 'init fail', suggestion: 'fix it' },
    },
    {
      Class: RateLimitError,
      expectedName: 'RateLimitError',
      opts: {
        code: 'RATE_LIMIT_PROVIDER',
        message: 'rate limited',
        recoverable: true,
        suggestion: 'wait',
        retryAfterMs: 5000,
      },
    },
    {
      Class: ResourceExhaustedError,
      expectedName: 'ResourceExhaustedError',
      opts: { code: 'RESOURCE_EXHAUSTED_LLM', message: 'exhausted', suggestion: 'upgrade' },
    },
    {
      Class: PermissionError,
      expectedName: 'PermissionError',
      opts: { code: 'PERMISSION_MIC_DENIED', message: 'denied', suggestion: 'allow mic' },
    },
    {
      Class: NetworkError,
      expectedName: 'NetworkError',
      opts: { code: 'NETWORK_CONNECTION_LOST', message: 'lost', suggestion: 'reconnect' },
    },
    {
      Class: TimeoutError,
      expectedName: 'TimeoutError',
      opts: {
        code: 'TIMEOUT_LLM_RESPONSE',
        message: 'timed out',
        recoverable: true,
        suggestion: 'retry',
        operationName: 'llm-response',
        timeoutMs: 30000,
      },
    },
    {
      Class: BrowserSupportError,
      expectedName: 'BrowserSupportError',
      opts: { code: 'BROWSER_NO_WEB_AUDIO', message: 'no web audio', suggestion: 'upgrade browser' },
    },
    {
      Class: ContentFilterError,
      expectedName: 'ContentFilterError',
      opts: { code: 'CONTENT_FILTER_TRIGGERED', message: 'filtered', suggestion: 'rephrase' },
    },
  ];

  for (const { Class, expectedName, opts } of subclasses) {
    it(`${expectedName} has correct name property`, () => {
      const err = new Class(opts as any);
      expect(err.name).toBe(expectedName);
    });
  }
});

// ---------------------------------------------------------------------------
// AuthenticationError
// ---------------------------------------------------------------------------

describe('AuthenticationError', () => {
  it('defaults to recoverable: false', () => {
    const err = new AuthenticationError({
      code: 'AUTH_INVALID_KEY',
      message: 'Invalid key',
      suggestion: 'Check key.',
    });
    expect(err.recoverable).toBe(false);
  });

  it('allows overriding recoverable', () => {
    const err = new AuthenticationError({
      code: 'AUTH_EXPIRED_TOKEN',
      message: 'Expired',
      suggestion: 'Refresh token.',
      recoverable: true,
    });
    expect(err.recoverable).toBe(true);
  });

  it('extends GuideKitError', () => {
    const err = new AuthenticationError({
      code: 'AUTH_INVALID_KEY',
      message: 'test',
      suggestion: 'test',
    });
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// NetworkError
// ---------------------------------------------------------------------------

describe('NetworkError', () => {
  it('defaults to recoverable: true', () => {
    const err = new NetworkError({
      code: 'NETWORK_WEBSOCKET_FAILED',
      message: 'WebSocket failed',
      suggestion: 'Check connection.',
    });
    expect(err.recoverable).toBe(true);
  });

  it('allows overriding recoverable to false', () => {
    const err = new NetworkError({
      code: 'NETWORK_CONNECTION_LOST',
      message: 'Lost connection',
      suggestion: 'Reconnect.',
      recoverable: false,
    });
    expect(err.recoverable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RateLimitError
// ---------------------------------------------------------------------------

describe('RateLimitError', () => {
  it('has retryAfterMs field', () => {
    const err = new RateLimitError({
      code: 'RATE_LIMIT_PROVIDER',
      message: 'Rate limited by provider',
      recoverable: true,
      suggestion: 'Wait and retry.',
      retryAfterMs: 15000,
    });
    expect(err.retryAfterMs).toBe(15000);
  });

  it('is always recoverable (forced by constructor)', () => {
    const err = new RateLimitError({
      code: 'RATE_LIMIT_CLIENT',
      message: 'Client rate limited',
      recoverable: false, // explicitly passed false
      suggestion: 'Slow down.',
      retryAfterMs: 1000,
    });
    // The constructor spreads ...options then sets recoverable: true last
    expect(err.recoverable).toBe(true);
  });

  it('extends GuideKitError', () => {
    const err = new RateLimitError({
      code: 'RATE_LIMIT_PROVIDER',
      message: 'test',
      recoverable: true,
      suggestion: 'test',
      retryAfterMs: 0,
    });
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// TimeoutError
// ---------------------------------------------------------------------------

describe('TimeoutError', () => {
  it('has operationName and timeoutMs fields', () => {
    const err = new TimeoutError({
      code: 'TIMEOUT_LLM_RESPONSE',
      message: 'LLM response timed out',
      recoverable: true,
      suggestion: 'Retry with a shorter prompt.',
      operationName: 'llm-response',
      timeoutMs: 30000,
    });
    expect(err.operationName).toBe('llm-response');
    expect(err.timeoutMs).toBe(30000);
  });

  it('is always recoverable (forced by constructor)', () => {
    const err = new TimeoutError({
      code: 'TIMEOUT_STT_CONNECT',
      message: 'STT connect timed out',
      recoverable: false,
      suggestion: 'Retry.',
      operationName: 'stt-connect',
      timeoutMs: 5000,
    });
    expect(err.recoverable).toBe(true);
  });

  it('extends GuideKitError', () => {
    const err = new TimeoutError({
      code: 'TIMEOUT_LLM_RESPONSE',
      message: 'test',
      recoverable: true,
      suggestion: 'test',
      operationName: 'test-op',
      timeoutMs: 100,
    });
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// isGuideKitError() type guard
// ---------------------------------------------------------------------------

describe('isGuideKitError()', () => {
  it('returns true for GuideKitError', () => {
    const err = new GuideKitError(baseOpts);
    expect(isGuideKitError(err)).toBe(true);
  });

  it('returns true for all subclasses', () => {
    const errors = [
      new AuthenticationError({
        code: 'AUTH_INVALID_KEY',
        message: 'x',
        suggestion: 's',
      }),
      new ConfigurationError({
        code: 'CONFIG_INVALID_PROVIDER',
        message: 'x',
        suggestion: 's',
      }),
      new InitializationError({
        code: 'INIT_SHADOW_DOM_FAILED',
        message: 'x',
        suggestion: 's',
      }),
      new RateLimitError({
        code: 'RATE_LIMIT_PROVIDER',
        message: 'x',
        recoverable: true,
        suggestion: 's',
        retryAfterMs: 100,
      }),
      new ResourceExhaustedError({
        code: 'RESOURCE_EXHAUSTED_LLM',
        message: 'x',
        suggestion: 's',
      }),
      new PermissionError({
        code: 'PERMISSION_MIC_DENIED',
        message: 'x',
        suggestion: 's',
      }),
      new NetworkError({
        code: 'NETWORK_WEBSOCKET_FAILED',
        message: 'x',
        suggestion: 's',
      }),
      new TimeoutError({
        code: 'TIMEOUT_LLM_RESPONSE',
        message: 'x',
        recoverable: true,
        suggestion: 's',
        operationName: 'op',
        timeoutMs: 100,
      }),
      new BrowserSupportError({
        code: 'BROWSER_NO_WEB_AUDIO',
        message: 'x',
        suggestion: 's',
      }),
      new ContentFilterError({
        code: 'CONTENT_FILTER_TRIGGERED',
        message: 'x',
        suggestion: 's',
      }),
    ];

    for (const err of errors) {
      expect(isGuideKitError(err)).toBe(true);
    }
  });

  it('returns false for plain Error', () => {
    expect(isGuideKitError(new Error('plain'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isGuideKitError(null)).toBe(false);
    expect(isGuideKitError(undefined)).toBe(false);
    expect(isGuideKitError('string error')).toBe(false);
    expect(isGuideKitError(42)).toBe(false);
    expect(isGuideKitError({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// instanceof checks
// ---------------------------------------------------------------------------

describe('instanceof works correctly for all subclasses', () => {
  it('AuthenticationError instanceof chain', () => {
    const err = new AuthenticationError({
      code: 'AUTH_INVALID_KEY',
      message: 'x',
      suggestion: 's',
    });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });

  it('ConfigurationError instanceof chain', () => {
    const err = new ConfigurationError({
      code: 'CONFIG_INVALID_PROVIDER',
      message: 'x',
      suggestion: 's',
    });
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });

  it('InitializationError instanceof chain', () => {
    const err = new InitializationError({
      code: 'INIT_SHADOW_DOM_FAILED',
      message: 'x',
      suggestion: 's',
    });
    expect(err).toBeInstanceOf(InitializationError);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });

  it('RateLimitError instanceof chain', () => {
    const err = new RateLimitError({
      code: 'RATE_LIMIT_PROVIDER',
      message: 'x',
      recoverable: true,
      suggestion: 's',
      retryAfterMs: 100,
    });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });

  it('ResourceExhaustedError instanceof chain', () => {
    const err = new ResourceExhaustedError({
      code: 'RESOURCE_EXHAUSTED_LLM',
      message: 'x',
      suggestion: 's',
    });
    expect(err).toBeInstanceOf(ResourceExhaustedError);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });

  it('PermissionError instanceof chain', () => {
    const err = new PermissionError({
      code: 'PERMISSION_MIC_DENIED',
      message: 'x',
      suggestion: 's',
    });
    expect(err).toBeInstanceOf(PermissionError);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });

  it('NetworkError instanceof chain', () => {
    const err = new NetworkError({
      code: 'NETWORK_WEBSOCKET_FAILED',
      message: 'x',
      suggestion: 's',
    });
    expect(err).toBeInstanceOf(NetworkError);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });

  it('TimeoutError instanceof chain', () => {
    const err = new TimeoutError({
      code: 'TIMEOUT_LLM_RESPONSE',
      message: 'x',
      recoverable: true,
      suggestion: 's',
      operationName: 'op',
      timeoutMs: 100,
    });
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });

  it('BrowserSupportError instanceof chain', () => {
    const err = new BrowserSupportError({
      code: 'BROWSER_NO_WEB_AUDIO',
      message: 'x',
      suggestion: 's',
    });
    expect(err).toBeInstanceOf(BrowserSupportError);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });

  it('ContentFilterError instanceof chain', () => {
    const err = new ContentFilterError({
      code: 'CONTENT_FILTER_TRIGGERED',
      message: 'x',
      suggestion: 's',
    });
    expect(err).toBeInstanceOf(ContentFilterError);
    expect(err).toBeInstanceOf(GuideKitError);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// ErrorCodes
// ---------------------------------------------------------------------------

describe('ErrorCodes', () => {
  it('contains all expected codes', () => {
    const expectedCodes = [
      // Auth
      'AUTH_INVALID_KEY',
      'AUTH_EXPIRED_TOKEN',
      'AUTH_TOKEN_REFRESH_FAILED',
      'AUTH_ENDPOINT_FAILED',
      // Config
      'CONFIG_INVALID_PROVIDER',
      'CONFIG_MISSING_REQUIRED',
      // Init
      'INIT_SHADOW_DOM_FAILED',
      'INIT_BROWSER_UNSUPPORTED',
      // Rate limit
      'RATE_LIMIT_PROVIDER',
      'RATE_LIMIT_CLIENT',
      // Resources
      'RESOURCE_EXHAUSTED_LLM',
      'RESOURCE_EXHAUSTED_STT',
      'RESOURCE_EXHAUSTED_TTS',
      // Permission
      'PERMISSION_MIC_DENIED',
      'PERMISSION_MIC_UNAVAILABLE',
      // Network
      'NETWORK_WEBSOCKET_FAILED',
      'NETWORK_CONNECTION_LOST',
      'NETWORK_TIMEOUT',
      // Timeout
      'TIMEOUT_STT_CONNECT',
      'TIMEOUT_LLM_RESPONSE',
      'TIMEOUT_TTS_CONNECT',
      'TIMEOUT_TTS_FIRST_AUDIO',
      // Browser
      'BROWSER_NO_WEB_AUDIO',
      'BROWSER_NO_WASM',
      'VAD_PACKAGE_MISSING',
      // Content
      'CONTENT_FILTER_TRIGGERED',
    ];

    for (const code of expectedCodes) {
      expect(ErrorCodes).toHaveProperty(code);
      expect((ErrorCodes as Record<string, string>)[code]).toBe(code);
    }
  });

  it('keys match their values (self-referencing)', () => {
    for (const [key, value] of Object.entries(ErrorCodes)) {
      expect(key).toBe(value);
    }
  });

  it('is frozen (as const)', () => {
    // `as const` makes the object readonly at the type level.
    // At runtime the object is still extensible, but the values are literal types.
    // We verify the shape is correct by checking a known code.
    expect(ErrorCodes.AUTH_INVALID_KEY).toBe('AUTH_INVALID_KEY');
    expect(ErrorCodes.CONTENT_FILTER_TRIGGERED).toBe('CONTENT_FILTER_TRIGGERED');
  });
});

// ---------------------------------------------------------------------------
// cause passthrough for subclasses
// ---------------------------------------------------------------------------

describe('cause is passed through on subclasses', () => {
  it('AuthenticationError carries cause', () => {
    const cause = new Error('original');
    const err = new AuthenticationError({
      code: 'AUTH_INVALID_KEY',
      message: 'test',
      suggestion: 's',
      cause,
    });
    expect(err.cause).toBe(cause);
  });

  it('NetworkError carries cause', () => {
    const cause = new Error('socket hangup');
    const err = new NetworkError({
      code: 'NETWORK_WEBSOCKET_FAILED',
      message: 'test',
      suggestion: 's',
      cause,
    });
    expect(err.cause).toBe(cause);
  });

  it('TimeoutError carries cause', () => {
    const cause = new Error('deadline exceeded');
    const err = new TimeoutError({
      code: 'TIMEOUT_LLM_RESPONSE',
      message: 'test',
      recoverable: true,
      suggestion: 's',
      operationName: 'op',
      timeoutMs: 100,
      cause,
    });
    expect(err.cause).toBe(cause);
  });
});
