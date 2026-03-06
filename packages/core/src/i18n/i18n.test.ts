// ---------------------------------------------------------------------------
// Tests for I18n
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { I18n } from './index.js';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('I18n', () => {
  let i18n: I18n;

  beforeEach(() => {
    // Default: no lang attribute set (falls back to 'en')
    Object.defineProperty(document.documentElement, 'lang', {
      value: '',
      configurable: true,
    });

    i18n = new I18n();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Constructor & defaults
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates an instance with default locale', () => {
      expect(i18n).toBeInstanceOf(I18n);
    });

    it('default locale is auto which resolves to en in test env', () => {
      expect(i18n.currentLocale).toBe('en');
    });

    it('accepts explicit locale codes', () => {
      const es = new I18n({ locale: 'es' });
      expect(es.currentLocale).toBe('es');
    });

    it('accepts debug option', () => {
      const debug = new I18n({ debug: true });
      expect(debug).toBeInstanceOf(I18n);
    });
  });

  // -----------------------------------------------------------------------
  // t(key) — translation lookup
  // -----------------------------------------------------------------------

  describe('t()', () => {
    it('returns correct English string for widgetTitle', () => {
      expect(i18n.t('widgetTitle')).toBe('GuideKit');
    });

    it('returns correct English string for openAssistant', () => {
      expect(i18n.t('openAssistant')).toBe('Open assistant');
    });

    it('returns correct English string for sendMessage', () => {
      expect(i18n.t('sendMessage')).toBe('Send message');
    });

    it('returns correct English string for inputPlaceholder', () => {
      expect(i18n.t('inputPlaceholder')).toBe('Ask a question...');
    });

    it('returns correct English string for errorGeneric', () => {
      expect(i18n.t('errorGeneric')).toBe('Something went wrong. Please try again.');
    });

    it('returns correct English string for greetingMessage', () => {
      expect(i18n.t('greetingMessage')).toBe('Hi! Need help navigating this page?');
    });

    it('returns correct Spanish string when locale is es', () => {
      const es = new I18n({ locale: 'es' });
      expect(es.t('openAssistant')).toBe('Abrir asistente');
    });

    it('returns correct French string when locale is fr', () => {
      const fr = new I18n({ locale: 'fr' });
      expect(fr.t('openAssistant')).toBe("Ouvrir l'assistant");
    });

    it('returns correct German string when locale is de', () => {
      const de = new I18n({ locale: 'de' });
      expect(de.t('openAssistant')).toBe('Assistent oeffnen');
    });

    it('returns correct Japanese string when locale is ja', () => {
      const ja = new I18n({ locale: 'ja' });
      expect(ja.t('openAssistant')).toBe('アシスタントを開く');
    });

    it('returns correct Chinese string when locale is zh', () => {
      const zh = new I18n({ locale: 'zh' });
      expect(zh.t('openAssistant')).toBe('打开助手');
    });

    it('returns correct Arabic string when locale is ar', () => {
      const ar = new I18n({ locale: 'ar' });
      expect(ar.t('openAssistant')).toBe('فتح المساعد');
    });

    it('returns correct Portuguese string when locale is pt', () => {
      const pt = new I18n({ locale: 'pt' });
      expect(pt.t('openAssistant')).toBe('Abrir assistente');
    });
  });

  // -----------------------------------------------------------------------
  // getStrings()
  // -----------------------------------------------------------------------

  describe('getStrings()', () => {
    it('returns all strings for the current locale', () => {
      const strings = i18n.getStrings();
      expect(strings).toHaveProperty('widgetTitle');
      expect(strings).toHaveProperty('openAssistant');
      expect(strings).toHaveProperty('closeAssistant');
      expect(strings).toHaveProperty('sendMessage');
      expect(strings).toHaveProperty('inputPlaceholder');
      expect(strings).toHaveProperty('errorGeneric');
    });

    it('returns a copy, not the internal object', () => {
      const strings1 = i18n.getStrings();
      const strings2 = i18n.getStrings();
      expect(strings1).not.toBe(strings2);
      expect(strings1).toEqual(strings2);
    });

    it('returns Spanish strings when locale is es', () => {
      const es = new I18n({ locale: 'es' });
      const strings = es.getStrings();
      expect(strings.sendMessage).toBe('Enviar mensaje');
    });
  });

  // -----------------------------------------------------------------------
  // setLocale()
  // -----------------------------------------------------------------------

  describe('setLocale()', () => {
    it('changes locale at runtime', () => {
      i18n.setLocale('fr');
      expect(i18n.currentLocale).toBe('fr');
    });

    it('changes translations after setLocale', () => {
      i18n.setLocale('es');
      expect(i18n.t('sendMessage')).toBe('Enviar mensaje');
    });

    it('can switch back to English', () => {
      i18n.setLocale('de');
      expect(i18n.t('sendMessage')).toBe('Nachricht senden');

      i18n.setLocale('en');
      expect(i18n.t('sendMessage')).toBe('Send message');
    });

    it('falls back to en for unknown locale', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      i18n.setLocale('xx' as any);
      expect(i18n.currentLocale).toBe('en');
      expect(i18n.t('sendMessage')).toBe('Send message');
    });

    it('supports custom string map', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      i18n.setLocale({
        widgetTitle: 'Custom Title',
        sendMessage: 'Custom Send',
        errorGeneric: 'Custom Error',
      } as any);

      expect(i18n.currentLocale).toBe('custom');
      expect(i18n.t('widgetTitle')).toBe('Custom Title');
    });
  });

  // -----------------------------------------------------------------------
  // currentLocale getter
  // -----------------------------------------------------------------------

  describe('currentLocale', () => {
    it('returns the resolved locale code', () => {
      const fr = new I18n({ locale: 'fr' });
      expect(fr.currentLocale).toBe('fr');
    });

    it('returns custom for custom string map', () => {
      const custom = new I18n({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        locale: {
          widgetTitle: 'Test',
          sendMessage: 'Go',
          errorGeneric: 'Oops',
        } as any,
      });
      expect(custom.currentLocale).toBe('custom');
    });
  });

  // -----------------------------------------------------------------------
  // Custom string map (partial overrides)
  // -----------------------------------------------------------------------

  describe('custom string map', () => {
    it('merges partial overrides with English defaults', () => {
      const custom = new I18n({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        locale: {
          widgetTitle: 'MyApp',
          sendMessage: 'Go!',
          errorGeneric: 'Error',
        } as any,
      });

      expect(custom.t('widgetTitle')).toBe('MyApp');
      // Keys not overridden should fall back to English
      expect(custom.t('openAssistant')).toBe('Open assistant');
    });
  });

  // -----------------------------------------------------------------------
  // Auto-detection from document.documentElement.lang
  // -----------------------------------------------------------------------

  describe('auto-detection', () => {
    it('detects fr from document lang attribute', () => {
      Object.defineProperty(document.documentElement, 'lang', {
        value: 'fr',
        configurable: true,
      });

      const auto = new I18n({ locale: 'auto' });
      expect(auto.currentLocale).toBe('fr');
    });

    it('detects es from document lang attribute', () => {
      Object.defineProperty(document.documentElement, 'lang', {
        value: 'es',
        configurable: true,
      });

      const auto = new I18n({ locale: 'auto' });
      expect(auto.currentLocale).toBe('es');
    });

    it('falls back to en when lang attribute is empty', () => {
      Object.defineProperty(document.documentElement, 'lang', {
        value: '',
        configurable: true,
      });

      const auto = new I18n({ locale: 'auto' });
      expect(auto.currentLocale).toBe('en');
    });

    it('falls back to en for unsupported lang attribute', () => {
      Object.defineProperty(document.documentElement, 'lang', {
        value: 'ko',
        configurable: true,
      });

      const auto = new I18n({ locale: 'auto' });
      expect(auto.currentLocale).toBe('en');
    });
  });

  // -----------------------------------------------------------------------
  // Language prefix matching
  // -----------------------------------------------------------------------

  describe('language prefix matching', () => {
    it('maps pt-BR to pt', () => {
      Object.defineProperty(document.documentElement, 'lang', {
        value: 'pt-BR',
        configurable: true,
      });

      const auto = new I18n({ locale: 'auto' });
      expect(auto.currentLocale).toBe('pt');
    });

    it('maps en-US to en', () => {
      Object.defineProperty(document.documentElement, 'lang', {
        value: 'en-US',
        configurable: true,
      });

      const auto = new I18n({ locale: 'auto' });
      expect(auto.currentLocale).toBe('en');
    });

    it('maps fr-CA to fr', () => {
      Object.defineProperty(document.documentElement, 'lang', {
        value: 'fr-CA',
        configurable: true,
      });

      const auto = new I18n({ locale: 'auto' });
      expect(auto.currentLocale).toBe('fr');
    });

    it('maps zh-TW to zh', () => {
      Object.defineProperty(document.documentElement, 'lang', {
        value: 'zh-TW',
        configurable: true,
      });

      const auto = new I18n({ locale: 'auto' });
      expect(auto.currentLocale).toBe('zh');
    });

    it('maps de-AT to de', () => {
      Object.defineProperty(document.documentElement, 'lang', {
        value: 'de-AT',
        configurable: true,
      });

      const auto = new I18n({ locale: 'auto' });
      expect(auto.currentLocale).toBe('de');
    });
  });

  // -----------------------------------------------------------------------
  // Unknown locale fallback
  // -----------------------------------------------------------------------

  describe('unknown locale fallback', () => {
    it('falls back to en for unknown explicit locale', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unknown = new I18n({ locale: 'zz' as any });
      expect(unknown.currentLocale).toBe('en');
      expect(unknown.t('sendMessage')).toBe('Send message');
    });

    it('returns English strings for unknown locale', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unknown = new I18n({ locale: 'kk' as any });
      const strings = unknown.getStrings();
      expect(strings.widgetTitle).toBe('GuideKit');
      expect(strings.openAssistant).toBe('Open assistant');
    });
  });
});
