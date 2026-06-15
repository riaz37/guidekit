import { useCallback, useState } from 'react';

/** localStorage key for privacy consent, scoped per GuideKit instance. */
export function getGuideKitConsentStorageKey(instanceId?: string): string {
  return `guidekit-consent:${instanceId ?? 'default'}`;
}

export function useGuideKitConsent(options?: {
  instanceId?: string;
  consentRequired?: boolean;
}): {
  hasConsent: boolean;
  grantConsent: () => void;
  revokeConsent: () => void;
} {
  const consentRequired = options?.consentRequired ?? false;
  const consentStorageKey = getGuideKitConsentStorageKey(options?.instanceId);

  const [hasConsent, setHasConsent] = useState<boolean>(() => {
    if (!consentRequired) return true;
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(consentStorageKey) === 'granted';
    } catch {
      return false;
    }
  });

  const grantConsent = useCallback(() => {
    try {
      localStorage.setItem(consentStorageKey, 'granted');
    } catch {
      // localStorage may be unavailable (e.g. private browsing quota)
    }
    setHasConsent(true);
  }, [consentStorageKey]);

  const revokeConsent = useCallback(() => {
    try {
      localStorage.removeItem(consentStorageKey);
    } catch {
      // ignore
    }
    setHasConsent(false);
  }, [consentStorageKey]);

  return { hasConsent, grantConsent, revokeConsent };
}
