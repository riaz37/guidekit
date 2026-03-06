// ---------------------------------------------------------------------------
// GuideKit SDK – Error Hierarchy
// ---------------------------------------------------------------------------

/**
 * Canonical error codes emitted by the SDK.
 * Keyed as `DOMAIN_DETAIL` so consumers can match on prefixes or exact values.
 */
export const ErrorCodes = {
  // Auth
  AUTH_INVALID_KEY: 'AUTH_INVALID_KEY',
  AUTH_EXPIRED_TOKEN: 'AUTH_EXPIRED_TOKEN',
  AUTH_TOKEN_REFRESH_FAILED: 'AUTH_TOKEN_REFRESH_FAILED',
  AUTH_ENDPOINT_FAILED: 'AUTH_ENDPOINT_FAILED',

  // Config
  CONFIG_INVALID_PROVIDER: 'CONFIG_INVALID_PROVIDER',
  CONFIG_MISSING_REQUIRED: 'CONFIG_MISSING_REQUIRED',

  // Init
  INIT_SHADOW_DOM_FAILED: 'INIT_SHADOW_DOM_FAILED',
  INIT_BROWSER_UNSUPPORTED: 'INIT_BROWSER_UNSUPPORTED',

  // Rate limit
  RATE_LIMIT_PROVIDER: 'RATE_LIMIT_PROVIDER',
  RATE_LIMIT_CLIENT: 'RATE_LIMIT_CLIENT',

  // Resources
  RESOURCE_EXHAUSTED_LLM: 'RESOURCE_EXHAUSTED_LLM',
  RESOURCE_EXHAUSTED_STT: 'RESOURCE_EXHAUSTED_STT',
  RESOURCE_EXHAUSTED_TTS: 'RESOURCE_EXHAUSTED_TTS',

  // Permission
  PERMISSION_MIC_DENIED: 'PERMISSION_MIC_DENIED',
  PERMISSION_MIC_UNAVAILABLE: 'PERMISSION_MIC_UNAVAILABLE',

  // Network
  NETWORK_WEBSOCKET_FAILED: 'NETWORK_WEBSOCKET_FAILED',
  NETWORK_CONNECTION_LOST: 'NETWORK_CONNECTION_LOST',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',

  // Timeout
  TIMEOUT_STT_CONNECT: 'TIMEOUT_STT_CONNECT',
  TIMEOUT_LLM_RESPONSE: 'TIMEOUT_LLM_RESPONSE',
  TIMEOUT_TTS_CONNECT: 'TIMEOUT_TTS_CONNECT',
  TIMEOUT_TTS_FIRST_AUDIO: 'TIMEOUT_TTS_FIRST_AUDIO',

  // Browser
  BROWSER_NO_WEB_AUDIO: 'BROWSER_NO_WEB_AUDIO',
  BROWSER_NO_WASM: 'BROWSER_NO_WASM',
  VAD_PACKAGE_MISSING: 'VAD_PACKAGE_MISSING',

  // Content
  CONTENT_FILTER_TRIGGERED: 'CONTENT_FILTER_TRIGGERED',

  // Privacy
  PRIVACY_HOOK_CANCELLED: 'PRIVACY_HOOK_CANCELLED',

  // Send
  SEND_IN_FLIGHT: 'SEND_IN_FLIGHT',
  INPUT_TOO_LONG: 'INPUT_TOO_LONG',

  // Knowledge
  KNOWLEDGE_INGESTION_FAILED: 'KNOWLEDGE_INGESTION_FAILED',
  KNOWLEDGE_STORE_QUOTA: 'KNOWLEDGE_STORE_QUOTA',
  KNOWLEDGE_DOCUMENT_PARSE_FAILED: 'KNOWLEDGE_DOCUMENT_PARSE_FAILED',
  KNOWLEDGE_SEARCH_FAILED: 'KNOWLEDGE_SEARCH_FAILED',

  // Cognitive
  COGNITIVE_PLAN_DEPTH_EXCEEDED: 'COGNITIVE_PLAN_DEPTH_EXCEEDED',
  COGNITIVE_BUDGET_EXCEEDED: 'COGNITIVE_BUDGET_EXCEEDED',
  COGNITIVE_MODEL_CAPABILITY: 'COGNITIVE_MODEL_CAPABILITY',

  // Plugin
  PLUGIN_INSTALL_FAILED: 'PLUGIN_INSTALL_FAILED',
  PLUGIN_DEPENDENCY_MISSING: 'PLUGIN_DEPENDENCY_MISSING',
  PLUGIN_TOOL_CONFLICT: 'PLUGIN_TOOL_CONFLICT',
  PLUGIN_LIFECYCLE_ERROR: 'PLUGIN_LIFECYCLE_ERROR',

  // Memory
  MEMORY_STORAGE_UNAVAILABLE: 'MEMORY_STORAGE_UNAVAILABLE',

  // General
  UNKNOWN: 'UNKNOWN',
} as const;

/** Union of every known error code string. */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ---------------------------------------------------------------------------
// Provider type
// ---------------------------------------------------------------------------

export type Provider = 'deepgram' | 'elevenlabs' | 'gemini' | 'openai' | 'anthropic' | 'web-speech' | (string & {});

// ---------------------------------------------------------------------------
// Base options shared by every error constructor
// ---------------------------------------------------------------------------

export interface GuideKitErrorOptions {
  code: string;
  message: string;
  provider?: Provider;
  recoverable: boolean;
  suggestion: string;
  docsUrl?: string;
  cause?: Error;
}

// ---------------------------------------------------------------------------
// Base error class
// ---------------------------------------------------------------------------

/**
 * Root error for every failure surfaced by the GuideKit SDK.
 *
 * Every instance carries structured metadata so UI layers can present
 * actionable feedback without parsing message strings.
 */
export class GuideKitError extends Error {
  readonly code: string;
  readonly provider?: Provider;
  readonly recoverable: boolean;
  readonly suggestion: string;
  readonly docsUrl: string;

  constructor(options: GuideKitErrorOptions) {
    super(options.message, { cause: options.cause });

    // Fix the prototype chain so `instanceof` works correctly when
    // compiling to ES5 or when subclassing built-in Error.
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = 'GuideKitError';
    this.code = options.code;
    this.provider = options.provider;
    this.recoverable = options.recoverable;
    this.suggestion = options.suggestion;
    this.docsUrl =
      options.docsUrl ?? `https://guidekit-docs.vercel.app/docs/error-codes#${options.code}`;
  }
}

// ---------------------------------------------------------------------------
// Specific error subclasses
// ---------------------------------------------------------------------------

/** Wrong or expired API key / token. */
export class AuthenticationError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: false, ...options });
    this.name = 'AuthenticationError';
  }
}

/** Invalid provider configuration supplied at init time. */
export class ConfigurationError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: false, ...options });
    this.name = 'ConfigurationError';
  }
}

/** SDK startup failure (Shadow DOM creation, browser too old, etc.). */
export class InitializationError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: false, ...options });
    this.name = 'InitializationError';
  }
}

/** Provider-side rate limit hit. Includes a retry hint. */
export class RateLimitError extends GuideKitError {
  readonly retryAfterMs: number;

  constructor(
    options: GuideKitErrorOptions & { retryAfterMs: number },
  ) {
    super({ ...options, recoverable: true });
    this.name = 'RateLimitError';
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Client-side cost / usage limits exhausted. */
export class ResourceExhaustedError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: false, ...options });
    this.name = 'ResourceExhaustedError';
  }
}

/** Microphone permission denied or device not available. */
export class PermissionError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: false, ...options });
    this.name = 'PermissionError';
  }
}

/** WebSocket dropped, HTTP connection failed, etc. */
export class NetworkError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: true, ...options });
    this.name = 'NetworkError';
  }
}

/** An operation exceeded its deadline. */
export class TimeoutError extends GuideKitError {
  readonly operationName: string;
  readonly timeoutMs: number;

  constructor(
    options: GuideKitErrorOptions & {
      operationName: string;
      timeoutMs: number;
    },
  ) {
    super({ ...options, recoverable: true });
    this.name = 'TimeoutError';
    this.operationName = options.operationName;
    this.timeoutMs = options.timeoutMs;
  }
}

/** Missing browser capability (Web Audio, WASM, VAD). */
export class BrowserSupportError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: false, ...options });
    this.name = 'BrowserSupportError';
  }
}

/** LLM safety / content filter triggered. */
export class ContentFilterError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: false, ...options });
    this.name = 'ContentFilterError';
  }
}

/** Knowledge base ingestion, search, or quota failure. */
export class KnowledgeError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: true, ...options });
    this.name = 'KnowledgeError';
  }
}

/** Plugin installation, dependency, or conflict failure. */
export class PluginError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: true, ...options });
    this.name = 'PluginError';
  }
}

/** Cognitive engine plan depth or budget limit exceeded. */
export class CognitiveError extends GuideKitError {
  constructor(
    options: Omit<GuideKitErrorOptions, 'recoverable'> & {
      recoverable?: boolean;
    },
  ) {
    super({ recoverable: true, ...options });
    this.name = 'CognitiveError';
  }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Narrows an unknown caught value to `GuideKitError`.
 *
 * ```ts
 * try { ... } catch (err) {
 *   if (isGuideKitError(err)) {
 *     console.log(err.code, err.suggestion);
 *   }
 * }
 * ```
 */
export function isGuideKitError(error: unknown): error is GuideKitError {
  return error instanceof GuideKitError;
}
