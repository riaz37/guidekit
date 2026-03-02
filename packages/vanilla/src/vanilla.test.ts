// ---------------------------------------------------------------------------
// @guidekit/vanilla — Unit tests
// ---------------------------------------------------------------------------
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @guidekit/core before importing the module under test
// ---------------------------------------------------------------------------

const mockInit = vi.fn().mockResolvedValue(undefined);
const mockDestroy = vi.fn().mockResolvedValue(undefined);
const mockSendText = vi.fn().mockResolvedValue('Hello from mock');
const mockHighlight = vi.fn().mockReturnValue(true);
const mockDismissHighlight = vi.fn();
const mockScrollToSection = vi.fn();
const mockStartTour = vi.fn();
const mockStopTour = vi.fn();
const mockNavigate = vi.fn().mockResolvedValue(true);
const mockSetPageContext = vi.fn();
const mockRegisterAction = vi.fn();
const mockStartListening = vi.fn().mockResolvedValue(undefined);
const mockStopListening = vi.fn();

const mockCoreInstance = {
  init: mockInit,
  destroy: mockDestroy,
  sendText: mockSendText,
  highlight: mockHighlight,
  dismissHighlight: mockDismissHighlight,
  scrollToSection: mockScrollToSection,
  startTour: mockStartTour,
  stopTour: mockStopTour,
  navigate: mockNavigate,
  setPageContext: mockSetPageContext,
  registerAction: mockRegisterAction,
  startListening: mockStartListening,
  stopListening: mockStopListening,
  agentState: { status: 'idle' as const },
  pageModel: null,
  isReady: true,
  quietMode: false,
  i18n: { t: (key: string) => key },
  checkHealth: vi.fn().mockResolvedValue({ overall: 'ok' }),
};

vi.mock('@guidekit/core', () => {
  return {
    GuideKitCore: vi.fn().mockImplementation(() => mockCoreInstance),
  };
});

// Import the module under test AFTER mocking
import {
  init,
  sendText,
  highlight,
  dismissHighlight,
  scrollToSection,
  startTour,
  stopTour,
  navigate,
  setPageContext,
  registerAction,
  startListening,
  stopListening,
  getAgentState,
  getPageModel,
  isReady,
  getQuietMode,
  setQuietMode,
  checkHealth,
  destroy,
  getCore,
  VERSION,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_OPTIONS = {
  llm: { provider: 'gemini' as const, apiKey: 'test-key' },
  agent: { name: 'Guide', greeting: 'Hello!' },
  headless: true, // skip widget DOM creation in tests
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@guidekit/vanilla', () => {
  afterEach(async () => {
    // Always clean up between tests
    await destroy();
    vi.clearAllMocks();
  });

  // =========================================================================
  // VERSION
  // =========================================================================

  describe('VERSION', () => {
    it('exports the correct version string', () => {
      expect(VERSION).toBe('0.1.0');
    });

    it('is of type string', () => {
      expect(typeof VERSION).toBe('string');
    });

    it('follows semver format', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  // =========================================================================
  // init()
  // =========================================================================

  describe('init()', () => {
    it('creates a GuideKitCore instance with valid options', async () => {
      await init(VALID_OPTIONS);
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledTimes(1);
    });

    it('calls core.init() during initialization', async () => {
      await init(VALID_OPTIONS);
      expect(mockInit).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — calling twice does not create a second instance', async () => {
      await init(VALID_OPTIONS);
      await init(VALID_OPTIONS);
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledTimes(1);
      expect(mockInit).toHaveBeenCalledTimes(1);
    });

    it('passes llm config to the core constructor', async () => {
      await init(VALID_OPTIONS);
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledWith(
        expect.objectContaining({
          llm: { provider: 'gemini', apiKey: 'test-key' },
        }),
      );
    });

    it('passes agent config to the core constructor', async () => {
      await init(VALID_OPTIONS);
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: { name: 'Guide', greeting: 'Hello!' },
        }),
      );
    });

    it('passes tokenEndpoint to the core constructor', async () => {
      await init({ ...VALID_OPTIONS, tokenEndpoint: '/api/guidekit/token' });
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenEndpoint: '/api/guidekit/token',
        }),
      );
    });

    it('passes onError callback to the core constructor', async () => {
      const onError = vi.fn();
      await init({ ...VALID_OPTIONS, onError });
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledWith(
        expect.objectContaining({
          onError,
        }),
      );
    });

    it('passes onEvent callback to the core constructor', async () => {
      const onEvent = vi.fn();
      await init({ ...VALID_OPTIONS, onEvent });
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledWith(
        expect.objectContaining({
          onEvent,
        }),
      );
    });

    it('passes onReady callback to the core constructor', async () => {
      const onReady = vi.fn();
      await init({ ...VALID_OPTIONS, onReady });
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledWith(
        expect.objectContaining({
          onReady,
        }),
      );
    });

    it('passes instanceId to the core constructor', async () => {
      await init({ ...VALID_OPTIONS, instanceId: 'my-instance' });
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: 'my-instance',
        }),
      );
    });

    it('passes stt config to the core constructor', async () => {
      const stt = { provider: 'deepgram' as const, apiKey: 'stt-key' };
      await init({ ...VALID_OPTIONS, stt });
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledWith(
        expect.objectContaining({ stt }),
      );
    });

    it('passes tts config to the core constructor', async () => {
      const tts = { provider: 'elevenlabs' as const, apiKey: 'tts-key' };
      await init({ ...VALID_OPTIONS, tts });
      const { GuideKitCore } = await import('@guidekit/core');
      expect(GuideKitCore).toHaveBeenCalledWith(
        expect.objectContaining({ tts }),
      );
    });
  });

  // =========================================================================
  // Pre-init guards (all methods should throw before init)
  // =========================================================================

  describe('pre-init guards', () => {
    const expectedError = 'GuideKit not initialized. Call GuideKit.init({...}) first.';

    it('sendText() throws before init', async () => {
      await expect(sendText('hello')).rejects.toThrow(expectedError);
    });

    it('highlight() throws before init', () => {
      expect(() => highlight({ sectionId: 'test' })).toThrow(expectedError);
    });

    it('dismissHighlight() throws before init', () => {
      expect(() => dismissHighlight()).toThrow(expectedError);
    });

    it('scrollToSection() throws before init', () => {
      expect(() => scrollToSection('test')).toThrow(expectedError);
    });

    it('startTour() throws before init', () => {
      expect(() => startTour(['a', 'b'])).toThrow(expectedError);
    });

    it('stopTour() throws before init', () => {
      expect(() => stopTour()).toThrow(expectedError);
    });

    it('navigate() throws before init', async () => {
      await expect(navigate('/about')).rejects.toThrow(expectedError);
    });

    it('setPageContext() throws before init', () => {
      expect(() => setPageContext({ page: 'home' })).toThrow(expectedError);
    });

    it('registerAction() throws before init', () => {
      expect(() =>
        registerAction('test', {
          description: 'test',
          parameters: {},
          handler: async () => ({}),
        }),
      ).toThrow(expectedError);
    });

    it('startListening() throws before init', async () => {
      await expect(startListening()).rejects.toThrow(expectedError);
    });

    it('stopListening() throws before init', () => {
      expect(() => stopListening()).toThrow(expectedError);
    });

    it('getAgentState() throws before init', () => {
      expect(() => getAgentState()).toThrow(expectedError);
    });

    it('getPageModel() throws before init', () => {
      expect(() => getPageModel()).toThrow(expectedError);
    });

    it('getQuietMode() throws before init', () => {
      expect(() => getQuietMode()).toThrow(expectedError);
    });

    it('setQuietMode() throws before init', () => {
      expect(() => setQuietMode(true)).toThrow(expectedError);
    });

    it('checkHealth() throws before init', async () => {
      await expect(checkHealth()).rejects.toThrow(expectedError);
    });
  });

  // =========================================================================
  // isReady()
  // =========================================================================

  describe('isReady()', () => {
    it('returns false before init', () => {
      expect(isReady()).toBe(false);
    });

    it('returns true after init (delegates to core.isReady)', async () => {
      await init(VALID_OPTIONS);
      expect(isReady()).toBe(true);
    });
  });

  // =========================================================================
  // getCore()
  // =========================================================================

  describe('getCore()', () => {
    it('returns null before init', () => {
      expect(getCore()).toBeNull();
    });

    it('returns the core instance after init', async () => {
      await init(VALID_OPTIONS);
      const core = getCore();
      expect(core).toBeDefined();
      expect(core).not.toBeNull();
    });

    it('returns null after destroy', async () => {
      await init(VALID_OPTIONS);
      await destroy();
      expect(getCore()).toBeNull();
    });
  });

  // =========================================================================
  // Post-init delegation
  // =========================================================================

  describe('post-init delegation', () => {
    beforeEach(async () => {
      await init(VALID_OPTIONS);
    });

    it('sendText() delegates to core.sendText()', async () => {
      const result = await sendText('Hello agent');
      expect(mockSendText).toHaveBeenCalledWith('Hello agent');
      expect(result).toBe('Hello from mock');
    });

    it('highlight() delegates to core.highlight()', () => {
      const params = { sectionId: 'hero', tooltip: 'Look here' };
      const result = highlight(params);
      expect(mockHighlight).toHaveBeenCalledWith(params);
      expect(result).toBe(true);
    });

    it('dismissHighlight() delegates to core.dismissHighlight()', () => {
      dismissHighlight();
      expect(mockDismissHighlight).toHaveBeenCalledTimes(1);
    });

    it('scrollToSection() delegates to core.scrollToSection()', () => {
      scrollToSection('features', 80);
      expect(mockScrollToSection).toHaveBeenCalledWith('features', 80);
    });

    it('startTour() delegates to core.startTour()', () => {
      const ids = ['step1', 'step2', 'step3'];
      startTour(ids, 'auto');
      expect(mockStartTour).toHaveBeenCalledWith(ids, 'auto');
    });

    it('stopTour() delegates to core.stopTour()', () => {
      stopTour();
      expect(mockStopTour).toHaveBeenCalledTimes(1);
    });

    it('navigate() delegates to core.navigate()', async () => {
      const result = await navigate('/pricing');
      expect(mockNavigate).toHaveBeenCalledWith('/pricing');
      expect(result).toBe(true);
    });

    it('setPageContext() delegates to core.setPageContext()', () => {
      const ctx = { userId: '123', plan: 'pro' };
      setPageContext(ctx);
      expect(mockSetPageContext).toHaveBeenCalledWith(ctx);
    });

    it('registerAction() delegates to core.registerAction()', () => {
      const action = {
        description: 'Add to cart',
        parameters: { productId: 'string' },
        handler: async (_params: Record<string, unknown>) => ({ success: true }),
      };
      registerAction('addToCart', action);
      expect(mockRegisterAction).toHaveBeenCalledWith('addToCart', action);
    });

    it('startListening() delegates to core.startListening()', async () => {
      await startListening();
      expect(mockStartListening).toHaveBeenCalledTimes(1);
    });

    it('stopListening() delegates to core.stopListening()', () => {
      stopListening();
      expect(mockStopListening).toHaveBeenCalledTimes(1);
    });

    it('getAgentState() returns core.agentState', () => {
      const state = getAgentState();
      expect(state).toEqual({ status: 'idle' });
    });

    it('getPageModel() returns core.pageModel', () => {
      const model = getPageModel();
      expect(model).toBeNull();
    });

    it('getQuietMode() returns core.quietMode', () => {
      expect(getQuietMode()).toBe(false);
    });

    it('setQuietMode() sets core.quietMode', () => {
      setQuietMode(true);
      expect(mockCoreInstance.quietMode).toBe(true);
    });
  });

  // =========================================================================
  // checkHealth()
  // =========================================================================

  describe('checkHealth()', () => {
    it('delegates to core.checkHealth after init', async () => {
      await init(VALID_OPTIONS);
      const result = await checkHealth();
      expect(mockCoreInstance.checkHealth).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ overall: 'ok' });
    });
  });

  // =========================================================================
  // destroy()
  // =========================================================================

  describe('destroy()', () => {
    it('calls core.destroy()', async () => {
      await init(VALID_OPTIONS);
      await destroy();
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it('sets core to null after destroy', async () => {
      await init(VALID_OPTIONS);
      await destroy();
      expect(getCore()).toBeNull();
    });

    it('makes isReady return false after destroy', async () => {
      await init(VALID_OPTIONS);
      expect(isReady()).toBe(true);
      await destroy();
      expect(isReady()).toBe(false);
    });

    it('allows re-init after destroy', async () => {
      await init(VALID_OPTIONS);
      await destroy();
      await init(VALID_OPTIONS);
      expect(getCore()).not.toBeNull();
    });

    it('is safe to call destroy without init', async () => {
      await expect(destroy()).resolves.not.toThrow();
    });

    it('is safe to call destroy twice', async () => {
      await init(VALID_OPTIONS);
      await destroy();
      await expect(destroy()).resolves.not.toThrow();
    });

    it('methods throw after destroy', async () => {
      await init(VALID_OPTIONS);
      await destroy();
      expect(() => getAgentState()).toThrow();
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('highlight returns the core result', async () => {
      await init(VALID_OPTIONS);
      mockHighlight.mockReturnValueOnce(false);
      expect(highlight({ selector: '.nonexistent' })).toBe(false);
    });

    it('scrollToSection works without offset', async () => {
      await init(VALID_OPTIONS);
      scrollToSection('footer');
      expect(mockScrollToSection).toHaveBeenCalledWith('footer', undefined);
    });

    it('startTour works without mode', async () => {
      await init(VALID_OPTIONS);
      startTour(['a', 'b']);
      expect(mockStartTour).toHaveBeenCalledWith(['a', 'b'], undefined);
    });

    it('sendText propagates errors from core', async () => {
      await init(VALID_OPTIONS);
      mockSendText.mockRejectedValueOnce(new Error('LLM failed'));
      await expect(sendText('test')).rejects.toThrow('LLM failed');
    });

    it('navigate propagates errors from core', async () => {
      await init(VALID_OPTIONS);
      mockNavigate.mockRejectedValueOnce(new Error('Nav failed'));
      await expect(navigate('/bad')).rejects.toThrow('Nav failed');
    });
  });
});
