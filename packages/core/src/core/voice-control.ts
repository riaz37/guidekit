import type { VoicePipeline } from '../voice/index.js';

export class VoiceController {
  constructor(
    private readonly debug: boolean,
    private getPipeline: () => VoicePipeline | null,
  ) {}

  async startListening(): Promise<void> {
    const pipeline = this.getPipeline();
    if (!pipeline) {
      throw new Error(
        'Voice is not available in this browser. Use Chrome or Edge on localhost/HTTPS for Web Speech, or configure Deepgram STT.',
      );
    }
    await pipeline.init();
    await pipeline.startListening();
  }

  stopListening(): void {
    this.getPipeline()?.stopListening();
  }

  stopSpeaking(): void {
    this.getPipeline()?.stopSpeaking();
  }

  get hasVoice(): boolean {
    return this.getPipeline() !== null;
  }
}
