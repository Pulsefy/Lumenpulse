import { fallbackReleaseMetadata } from './release-metadata';

export interface ErrorReportOptions {
  optOut?: boolean;
  environment?: string;
}

class ErrorReporter {
  private isEnabled = true;

  init(options?: ErrorReportOptions) {
    if (options?.optOut || process.env.NODE_ENV === 'development') {
      this.isEnabled = false;
    }
  }

  /**
   * Explicit on/off switch driven by the user's crash-reporting preference in
   * Settings › Data & Privacy. Unlike {@link init} this honours `true` even in
   * development, because it reflects a deliberate choice rather than a default.
   */
  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }

  /** Whether reports are currently being sent. */
  get enabled(): boolean {
    return this.isEnabled;
  }

  captureError(error: Error, extra?: Record<string, unknown>) {
    if (!this.isEnabled) return;
    const sanitized = this.scrubPayload({ error: error.message, stack: error.stack, extra });
    console.error(`[ErrorReporting:${fallbackReleaseMetadata.releases[0]?.version}]`, sanitized);
  }

  private scrubPayload(data: Record<string, unknown>): Record<string, unknown> {
    const raw = JSON.stringify(data);
    const scrubbed = raw.replace(/G[A-Z2-7]{55}/g, '[REDACTED_ADDRESS]');
    return JSON.parse(scrubbed);
  }
}

export const errorReporter = new ErrorReporter();
