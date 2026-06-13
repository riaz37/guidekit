import type { VoicePipeline } from '../voice/index.js';

export class VoiceController {
  constructor(
    private readonly debug: boolean,
    private getPipeline: () => VoicePipeline | null,
  ) {}

  async startListening(): Promise<void> {
    const pipeline = this.getPipeline();
    if (!pipeline) {
      if (this.debug) {
        console.debug('[GuideKit:Core] No voice pipeline configured — cannot start listening');
      }
      return;
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
