// -----------------------------------------------------------------------
// GuideKit SDK - Internationalization (i18n) Module
// Provides localized strings for all SDK UI elements.
// -----------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All translatable string keys used by the SDK UI. */
export interface I18nStrings {
  // Widget
  widgetTitle: string;
  openAssistant: string;
  closeAssistant: string;
  closePanel: string;
  sendMessage: string;
  inputPlaceholder: string;
  listeningPlaceholder: string;
  startVoice: string;
  stopVoice: string;

  // Status
  statusOnline: string;
  statusConnecting: string;
  statusOffline: string;
  statusListening: string;
  statusSpeaking: string;
  statusProcessing: string;

  // Empty state
  emptyStateMessage: string;

  // Errors
  errorGeneric: string;
  errorNetwork: string;
  errorMicDenied: string;
  errorRateLimit: string;

  // Proactive
  greetingMessage: string;
  idleHelpMessage: string;

  // Voice
  voiceDegradedNotice: string;

  // Quiet mode
  quietModeOn: string;
  quietModeOff: string;
}

export type SupportedLocale = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'zh' | 'ar' | 'pt';

export type LocaleInput = SupportedLocale | 'auto' | I18nStrings;

export interface I18nOptions {
  locale?: LocaleInput;
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// Built-in locale data
// ---------------------------------------------------------------------------

const en: I18nStrings = {
  widgetTitle: 'GuideKit',
  openAssistant: 'Open assistant',
  closeAssistant: 'Close assistant',
  closePanel: 'Close assistant panel',
  sendMessage: 'Send message',
  inputPlaceholder: 'Ask a question...',
  listeningPlaceholder: 'Listening...',
  startVoice: 'Start voice input',
  stopVoice: 'Stop voice input',

  statusOnline: 'Online',
  statusConnecting: 'Connecting...',
  statusOffline: 'Offline',
  statusListening: 'Listening...',
  statusSpeaking: 'Speaking...',
  statusProcessing: 'Processing...',

  emptyStateMessage:
    'Ask me anything about this page. I can help you navigate, understand content, and more.',

  errorGeneric: 'Something went wrong. Please try again.',
  errorNetwork: 'Connection lost. Reconnecting...',
  errorMicDenied:
    'Microphone access was denied. Please enable it in your browser settings.',
  errorRateLimit: 'Too many requests. Please wait a moment.',

  greetingMessage: 'Hi! Need help navigating this page?',
  idleHelpMessage: 'Still here if you need help!',

  voiceDegradedNotice: 'Voice unavailable. Switched to text mode.',

  quietModeOn: 'Notifications paused',
  quietModeOff: 'Notifications resumed',
};

const es: I18nStrings = {
  widgetTitle: 'GuideKit',
  openAssistant: 'Abrir asistente',
  closeAssistant: 'Cerrar asistente',
  closePanel: 'Cerrar panel del asistente',
  sendMessage: 'Enviar mensaje',
  inputPlaceholder: 'Haz una pregunta...',
  listeningPlaceholder: 'Escuchando...',
  startVoice: 'Iniciar entrada de voz',
  stopVoice: 'Detener entrada de voz',

  statusOnline: 'En linea',
  statusConnecting: 'Conectando...',
  statusOffline: 'Sin conexion',
  statusListening: 'Escuchando...',
  statusSpeaking: 'Hablando...',
  statusProcessing: 'Procesando...',

  emptyStateMessage:
    'Preguntame lo que quieras sobre esta pagina. Puedo ayudarte a navegar, entender el contenido y mucho mas.',

  errorGeneric: 'Algo salio mal. Por favor, intentalo de nuevo.',
  errorNetwork: 'Se perdio la conexion. Reconectando...',
  errorMicDenied:
    'Se denego el acceso al microfono. Activalo en la configuracion de tu navegador.',
  errorRateLimit: 'Demasiadas solicitudes. Espera un momento, por favor.',

  greetingMessage: 'Hola! Necesitas ayuda para navegar esta pagina?',
  idleHelpMessage: 'Sigo aqui por si necesitas ayuda.',

  voiceDegradedNotice: 'Voz no disponible. Se cambio al modo de texto.',

  quietModeOn: 'Notificaciones en pausa',
  quietModeOff: 'Notificaciones reanudadas',
};

const fr: I18nStrings = {
  widgetTitle: 'GuideKit',
  openAssistant: "Ouvrir l'assistant",
  closeAssistant: "Fermer l'assistant",
  closePanel: "Fermer le panneau de l'assistant",
  sendMessage: 'Envoyer le message',
  inputPlaceholder: 'Posez une question...',
  listeningPlaceholder: "A l'ecoute...",
  startVoice: 'Activer la saisie vocale',
  stopVoice: 'Arreter la saisie vocale',

  statusOnline: 'En ligne',
  statusConnecting: 'Connexion en cours...',
  statusOffline: 'Hors ligne',
  statusListening: "A l'ecoute...",
  statusSpeaking: 'En train de parler...',
  statusProcessing: 'Traitement en cours...',

  emptyStateMessage:
    'Posez-moi vos questions sur cette page. Je peux vous aider a naviguer, comprendre le contenu et bien plus.',

  errorGeneric: "Une erreur s'est produite. Veuillez reessayer.",
  errorNetwork: 'Connexion perdue. Reconnexion en cours...',
  errorMicDenied:
    "L'acces au microphone a ete refuse. Veuillez l'activer dans les parametres de votre navigateur.",
  errorRateLimit: 'Trop de requetes. Veuillez patienter un instant.',

  greetingMessage: 'Bonjour ! Besoin d\'aide pour naviguer sur cette page ?',
  idleHelpMessage: 'Je suis toujours la si vous avez besoin d\'aide !',

  voiceDegradedNotice: 'Voix indisponible. Passage en mode texte.',

  quietModeOn: 'Notifications en pause',
  quietModeOff: 'Notifications reprises',
};

const de: I18nStrings = {
  widgetTitle: 'GuideKit',
  openAssistant: 'Assistent oeffnen',
  closeAssistant: 'Assistent schliessen',
  closePanel: 'Assistenten-Panel schliessen',
  sendMessage: 'Nachricht senden',
  inputPlaceholder: 'Stelle eine Frage...',
  listeningPlaceholder: 'Hoert zu...',
  startVoice: 'Spracheingabe starten',
  stopVoice: 'Spracheingabe stoppen',

  statusOnline: 'Online',
  statusConnecting: 'Verbindung wird hergestellt...',
  statusOffline: 'Offline',
  statusListening: 'Hoert zu...',
  statusSpeaking: 'Spricht...',
  statusProcessing: 'Verarbeitung...',

  emptyStateMessage:
    'Frag mich alles zu dieser Seite. Ich kann dir bei der Navigation helfen, Inhalte erklaeren und vieles mehr.',

  errorGeneric: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
  errorNetwork: 'Verbindung verloren. Verbindung wird wiederhergestellt...',
  errorMicDenied:
    'Mikrofonzugriff wurde verweigert. Bitte aktiviere ihn in deinen Browsereinstellungen.',
  errorRateLimit: 'Zu viele Anfragen. Bitte warte einen Moment.',

  greetingMessage: 'Hallo! Brauchst du Hilfe beim Navigieren auf dieser Seite?',
  idleHelpMessage: 'Ich bin noch da, falls du Hilfe brauchst!',

  voiceDegradedNotice: 'Sprache nicht verfuegbar. Wechsel zum Textmodus.',

  quietModeOn: 'Benachrichtigungen pausiert',
  quietModeOff: 'Benachrichtigungen fortgesetzt',
};

const ja: I18nStrings = {
  widgetTitle: 'GuideKit',
  openAssistant: 'アシスタントを開く',
  closeAssistant: 'アシスタントを閉じる',
  closePanel: 'アシスタントパネルを閉じる',
  sendMessage: 'メッセージを送信',
  inputPlaceholder: '質問してください...',
  listeningPlaceholder: '聞いています...',
  startVoice: '音声入力を開始',
  stopVoice: '音声入力を停止',

  statusOnline: 'オンライン',
  statusConnecting: '接続中...',
  statusOffline: 'オフライン',
  statusListening: '聞いています...',
  statusSpeaking: '話しています...',
  statusProcessing: '処理中...',

  emptyStateMessage:
    'このページについて何でも聞いてください。ナビゲーション、コンテンツの理解など、お手伝いします。',

  errorGeneric: '問題が発生しました。もう一度お試しください。',
  errorNetwork: '接続が切断されました。再接続しています...',
  errorMicDenied:
    'マイクへのアクセスが拒否されました。ブラウザの設定で有効にしてください。',
  errorRateLimit: 'リクエストが多すぎます。少々お待ちください。',

  greetingMessage: 'こんにちは！このページのナビゲーションでお手伝いしましょうか？',
  idleHelpMessage: 'お手伝いが必要でしたら、いつでもどうぞ！',

  voiceDegradedNotice: '音声が利用できません。テキストモードに切り替えました。',

  quietModeOn: '通知を一時停止中',
  quietModeOff: '通知を再開しました',
};

const zh: I18nStrings = {
  widgetTitle: 'GuideKit',
  openAssistant: '打开助手',
  closeAssistant: '关闭助手',
  closePanel: '关闭助手面板',
  sendMessage: '发送消息',
  inputPlaceholder: '请提问...',
  listeningPlaceholder: '正在聆听...',
  startVoice: '开始语音输入',
  stopVoice: '停止语音输入',

  statusOnline: '在线',
  statusConnecting: '连接中...',
  statusOffline: '离线',
  statusListening: '正在聆听...',
  statusSpeaking: '正在播报...',
  statusProcessing: '处理中...',

  emptyStateMessage:
    '关于这个页面，你可以问我任何问题。我可以帮你浏览页面、理解内容等等。',

  errorGeneric: '出了点问题，请重试。',
  errorNetwork: '连接已断开，正在重新连接...',
  errorMicDenied: '麦克风权限被拒绝，请在浏览器设置中开启。',
  errorRateLimit: '请求过于频繁，请稍候再试。',

  greetingMessage: '你好！需要帮你浏览这个页面吗？',
  idleHelpMessage: '我还在这里，随时可以帮忙！',

  voiceDegradedNotice: '语音不可用，已切换为文字模式。',

  quietModeOn: '通知已暂停',
  quietModeOff: '通知已恢复',
};

const ar: I18nStrings = {
  widgetTitle: 'GuideKit',
  openAssistant: 'فتح المساعد',
  closeAssistant: 'إغلاق المساعد',
  closePanel: 'إغلاق لوحة المساعد',
  sendMessage: 'إرسال الرسالة',
  inputPlaceholder: 'اطرح سؤالاً...',
  listeningPlaceholder: 'جارٍ الاستماع...',
  startVoice: 'بدء الإدخال الصوتي',
  stopVoice: 'إيقاف الإدخال الصوتي',

  statusOnline: 'متصل',
  statusConnecting: 'جارٍ الاتصال...',
  statusOffline: 'غير متصل',
  statusListening: 'جارٍ الاستماع...',
  statusSpeaking: 'جارٍ التحدث...',
  statusProcessing: 'جارٍ المعالجة...',

  emptyStateMessage:
    'اسألني أي شيء عن هذه الصفحة. يمكنني مساعدتك في التنقل وفهم المحتوى والمزيد.',

  errorGeneric: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
  errorNetwork: 'انقطع الاتصال. جارٍ إعادة الاتصال...',
  errorMicDenied:
    'تم رفض الوصول إلى الميكروفون. يرجى تفعيله من إعدادات المتصفح.',
  errorRateLimit: 'طلبات كثيرة جداً. يرجى الانتظار لحظة.',

  greetingMessage: 'مرحباً! هل تحتاج مساعدة في تصفح هذه الصفحة؟',
  idleHelpMessage: 'ما زلت هنا إذا احتجت مساعدة!',

  voiceDegradedNotice: 'الصوت غير متاح. تم التبديل إلى الوضع النصي.',

  quietModeOn: 'الإشعارات متوقفة مؤقتاً',
  quietModeOff: 'تم استئناف الإشعارات',
};

const pt: I18nStrings = {
  widgetTitle: 'GuideKit',
  openAssistant: 'Abrir assistente',
  closeAssistant: 'Fechar assistente',
  closePanel: 'Fechar painel do assistente',
  sendMessage: 'Enviar mensagem',
  inputPlaceholder: 'Faca uma pergunta...',
  listeningPlaceholder: 'Ouvindo...',
  startVoice: 'Iniciar entrada de voz',
  stopVoice: 'Parar entrada de voz',

  statusOnline: 'Online',
  statusConnecting: 'Conectando...',
  statusOffline: 'Offline',
  statusListening: 'Ouvindo...',
  statusSpeaking: 'Falando...',
  statusProcessing: 'Processando...',

  emptyStateMessage:
    'Pergunte-me o que quiser sobre esta pagina. Posso ajudar a navegar, entender o conteudo e muito mais.',

  errorGeneric: 'Algo deu errado. Por favor, tente novamente.',
  errorNetwork: 'Conexao perdida. Reconectando...',
  errorMicDenied:
    'O acesso ao microfone foi negado. Ative-o nas configuracoes do seu navegador.',
  errorRateLimit: 'Muitas solicitacoes. Aguarde um momento, por favor.',

  greetingMessage: 'Ola! Precisa de ajuda para navegar nesta pagina?',
  idleHelpMessage: 'Ainda estou aqui se precisar de ajuda!',

  voiceDegradedNotice: 'Voz indisponivel. Alternado para o modo texto.',

  quietModeOn: 'Notificacoes pausadas',
  quietModeOff: 'Notificacoes retomadas',
};

// ---------------------------------------------------------------------------
// Locale registry
// ---------------------------------------------------------------------------

const BUILTIN_LOCALES: Record<SupportedLocale, I18nStrings> = {
  en,
  es,
  fr,
  de,
  ja,
  zh,
  ar,
  pt,
};

const SUPPORTED_LOCALE_CODES = new Set<string>(Object.keys(BUILTIN_LOCALES));

const LOG_PREFIX = '[GuideKit:I18n]';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSupportedLocale(code: string): code is SupportedLocale {
  return SUPPORTED_LOCALE_CODES.has(code);
}

function isI18nStrings(input: unknown): input is I18nStrings {
  if (typeof input !== 'object' || input === null) return false;
  // Check for a handful of required keys to distinguish from other objects
  const obj = input as Record<string, unknown>;
  return (
    typeof obj.widgetTitle === 'string' &&
    typeof obj.sendMessage === 'string' &&
    typeof obj.errorGeneric === 'string'
  );
}

/**
 * Detect the user's locale from the `<html lang>` attribute.
 * SSR-safe: returns 'en' when `document` is not available.
 */
function detectLocaleFromDocument(): SupportedLocale {
  if (typeof document === 'undefined') {
    return 'en';
  }

  const htmlLang = document.documentElement?.lang;
  if (!htmlLang) {
    return 'en';
  }

  const normalized = htmlLang.trim().toLowerCase();

  // Exact match (e.g. 'en', 'pt')
  if (isSupportedLocale(normalized)) {
    return normalized;
  }

  // Language prefix match (e.g. 'en-US' -> 'en', 'pt-BR' -> 'pt')
  const prefix = normalized.split('-')[0] ?? '';
  if (isSupportedLocale(prefix)) {
    return prefix;
  }

  return 'en';
}

// ---------------------------------------------------------------------------
// I18n class
// ---------------------------------------------------------------------------

export class I18n {
  private strings: I18nStrings;
  private resolvedLocale: string;
  private debug: boolean;

  constructor(options?: I18nOptions) {
    this.debug = options?.debug ?? false;
    const locale = options?.locale ?? 'auto';
    const { strings, resolvedLocale } = this.resolve(locale);
    this.strings = strings;
    this.resolvedLocale = resolvedLocale;

    if (this.debug) {
      console.debug(`${LOG_PREFIX} Initialized with locale "${this.resolvedLocale}"`);
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Get a translated string by key. */
  t(key: keyof I18nStrings): string {
    const value = this.strings[key];
    if (value === undefined) {
      if (this.debug) {
        console.warn(`${LOG_PREFIX} Missing translation key "${key}"`);
      }
      // Fallback to English for missing keys in custom string maps
      return en[key] ?? key;
    }
    return value;
  }

  /** Get all strings for the current locale. */
  getStrings(): I18nStrings {
    return { ...this.strings };
  }

  /** Change the current locale at runtime. */
  setLocale(locale: LocaleInput): void {
    const { strings, resolvedLocale } = this.resolve(locale);
    this.strings = strings;
    this.resolvedLocale = resolvedLocale;

    if (this.debug) {
      console.debug(`${LOG_PREFIX} Locale changed to "${this.resolvedLocale}"`);
    }
  }

  /** The current resolved locale code (e.g. 'en', 'fr', or 'custom'). */
  get currentLocale(): string {
    return this.resolvedLocale;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private resolve(locale: LocaleInput): {
    strings: I18nStrings;
    resolvedLocale: string;
  } {
    // Custom string map provided directly
    if (isI18nStrings(locale)) {
      // Merge with English defaults so partial overrides still work
      return {
        strings: { ...en, ...locale },
        resolvedLocale: 'custom',
      };
    }

    // Auto-detect from the document
    if (locale === 'auto') {
      const detected = detectLocaleFromDocument();
      if (this.debug) {
        console.debug(`${LOG_PREFIX} Auto-detected locale "${detected}"`);
      }
      return {
        strings: BUILTIN_LOCALES[detected],
        resolvedLocale: detected,
      };
    }

    // Explicit supported locale code
    if (isSupportedLocale(locale)) {
      return {
        strings: BUILTIN_LOCALES[locale],
        resolvedLocale: locale,
      };
    }

    // Unknown locale code -- fall back to English
    if (this.debug) {
      console.warn(
        `${LOG_PREFIX} Unknown locale "${String(locale)}", falling back to "en"`,
      );
    }
    return {
      strings: en,
      resolvedLocale: 'en',
    };
  }
}
