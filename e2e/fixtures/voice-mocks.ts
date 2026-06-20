import type { Page } from '@playwright/test';

/** Gemini SSE stream with a plain text reply (no tool calls). */
export function geminiTextSse(text: string): string {
  const payload = {
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: 'STOP',
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

/** Mock /api/guidekit/llm with a single text response. */
export async function mockLlmTextRoute(page: Page, text: string): Promise<void> {
  await page.route('**/api/guidekit/llm', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: geminiTextSse(text),
    });
  });
}

/**
 * Browser mocks for Web Speech STT and microphone access.
 * Used by all voice E2E specs — do not swap for Deepgram/ElevenLabs here.
 * VAD still loads from @guidekit/vad; allow ~15s on first mic click in CI.
 */
export async function installVoiceBrowserMocks(
  page: Page,
  transcript = 'hello from voice',
): Promise<void> {
  await page.addInitScript((finalText) => {
    const w = window as Window & {
      SpeechRecognition?: new () => MockRecognition;
      webkitSpeechRecognition?: new () => MockRecognition;
    };

    class MockRecognition extends EventTarget {
      lang = 'en-US';
      continuous = true;
      interimResults = true;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((event: { resultIndex: number; results: MockResultList }) => void) | null = null;
      onerror: ((event: { error: string; message: string }) => void) | null = null;
      onend: (() => void) | null = null;

      start(): void {
        window.setTimeout(() => {
          this.onstart?.();
          this.dispatchEvent(new Event('start'));
          window.setTimeout(() => {
            const alternative = { transcript: finalText, confidence: 0.95 };
            const result: MockResult = {
              0: alternative,
              length: 1,
              isFinal: true,
              item: (index: number) => result[index],
            };
            const results: MockResultList = {
              0: result,
              length: 1,
              item: (index: number) => results[index],
            };
            this.onresult?.({ resultIndex: 0, results });
          }, 1200);
        }, 50);
      }

      stop(): void {
        this.onend?.();
      }

      abort(): void {
        this.onend?.();
      }
    }

    interface MockAlternative {
      transcript: string;
      confidence: number;
    }

    interface MockResult {
      0: MockAlternative;
      length: number;
      isFinal: boolean;
      item: (index: number) => MockAlternative;
    }

    interface MockResultList {
      0: MockResult;
      length: number;
      item: (index: number) => MockResult;
    }

    w.SpeechRecognition = MockRecognition;
    w.webkitSpeechRecognition = MockRecognition;

    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.getUserMedia) {
      mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        const osc = ctx.createOscillator();
        osc.connect(dest);
        osc.start();
        return dest.stream;
      };
    }
  }, transcript);
}
