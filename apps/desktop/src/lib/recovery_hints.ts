// SPDX-License-Identifier: MPL-2.0
// Render journals are private app metadata. Never display raw exception strings
// or echo unknown diagnostic codes back into the UI.
export interface RecoveryStatus {
  state: string;
  failure_code?: string;
}

/** Fixed, explanatory hints only; neither fault classification nor a retry
 * confirms that the local Chatterbox model, generated WAV or Hindi speech works.
 */
export function recoveryHint(job: RecoveryStatus): string {
  switch (job.state) {
    case "interrupted":
      return "The previous worker stopped. This entry cannot resume in place; a new render must be started manually.";
    case "cancelled":
      return "Rendering was cancelled. A new attempt is optional and requires confirmation.";
    case "running":
      return "The current rendering worker is still active.";
    case "completed":
      return "The journal reports completion; this does not certify audible Hindi narration.";
    case "failed":
      switch (job.failure_code) {
        case "incomplete":
          return "Fewer segments were saved than planned. Review the current story and start a new render if needed.";
        case "validation":
          return "The renderer rejected input or output limits. Check the story readiness audit before retrying.";
        case "storage":
          return "A local file operation could not finish. Review free space and folder permissions before retrying.";
        case "resources":
          return "The renderer encountered a resource limit. Check available memory and model setup.";
        case "runtime":
          return "The speech runtime or another processing step stopped. Inspect local model setup and retry manually.";
        default:
          return "The render did not finish. The exact reason is not stored in this privacy-safe history.";
      }
    default:
      return "The job state is unavailable; no automatic action will be taken.";
  }
}
