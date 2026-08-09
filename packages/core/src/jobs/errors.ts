/**
 * Failure taxonomy (docs/02-jobs.md):
 * - PermanentError: validation / 4xx — fail immediately, human-readable reason.
 * - TransientError (and any unknown throw): retry with exponential backoff up
 *   to max_attempts, then dead.
 * - BudgetError: a daily spend cap was hit — park the job without consuming an
 *   attempt and retry when the rolling window frees up.
 */

export class PermanentError extends Error {
  readonly jobErrorClass = "permanent" as const;
  /**
   * Hebrew string a customer may read (video_renders.error) when this error
   * kills a render. The message itself is the diagnostic and lands on
   * jobs.last_error. Absent means the render shows the generic Hebrew failure
   * (RENDER_FAILED_MESSAGE) — video_renders.error is Hebrew by construction.
   */
  readonly customerMessage?: string;

  constructor(message: string, opts?: { customerMessage?: string }) {
    super(message);
    this.customerMessage = opts?.customerMessage;
  }
}

export class TransientError extends Error {
  readonly jobErrorClass = "transient" as const;
}

export class BudgetError extends Error {
  readonly jobErrorClass = "budget" as const;
  readonly resumeAt: Date;

  constructor(message: string, resumeAt?: Date) {
    super(message);
    this.resumeAt = resumeAt ?? new Date(Date.now() + 60 * 60 * 1000);
  }
}
