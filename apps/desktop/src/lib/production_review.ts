// SPDX-License-Identifier: MPL-2.0
// Deliberately transient human review states; never infer quality from mock audio.
export const REVIEW_STEPS = [
  "listened_in_full",
  "pronunciation_reviewed",
  "character_turns_reviewed",
  "subtitles_reviewed",
] as const;

export type ReviewStep = typeof REVIEW_STEPS[number];

export interface AudioReview {
  audioId: string;
  subtitleExported: boolean;
  completed: Record<ReviewStep, boolean>;
}

export interface RetryHistory {
  story_id: string;
  state: string;
  done: number;
  total: number;
}

/** Local UI checklist only. New rendered audio must receive a new checklist. */
export function freshAudioReview(audioId: string): AudioReview {
  if (!audioId.trim()) throw new Error("Audio identity is missing.");
  return {
    audioId,
    subtitleExported: false,
    completed: {
      listened_in_full: false,
      pronunciation_reviewed: false,
      character_turns_reviewed: false,
      subtitles_reviewed: false,
    },
  };
}

export function reviewForAudio(review: AudioReview | null, audioId: string): AudioReview {
  return review?.audioId === audioId ? review : freshAudioReview(audioId);
}

export function recordSubtitleExport(review: AudioReview | null, audioId: string): AudioReview {
  return { ...reviewForAudio(review, audioId), subtitleExported: true };
}

export function updateAudioReview(
  review: AudioReview | null, audioId: string, step: ReviewStep, checked: boolean,
): AudioReview {
  const current = reviewForAudio(review, audioId);
  if (!REVIEW_STEPS.includes(step) || typeof checked !== "boolean") {
    throw new Error("Unsupported human review status.");
  }
  if (step === "subtitles_reviewed" && checked && !current.subtitleExported) {
    throw new Error("Export and inspect the SRT before marking subtitles reviewed.");
  }
  return {
    ...current,
    completed: { ...current.completed, [step]: checked },
  };
}

export function reviewProgress(review: AudioReview | null, audioId: string): {
  completed: number;
  total: number;
  personallyReviewed: boolean;
} {
  const current = reviewForAudio(review, audioId);
  const completed = REVIEW_STEPS.filter(step => current.completed[step]).length;
  return { completed, total: REVIEW_STEPS.length, personallyReviewed: completed === REVIEW_STEPS.length };
}

/** A history record is metadata, not a saved snapshot of the original render scope.
 * Retries must use a new job ID and validate the user's CURRENT story again.
 */
export function canOfferManualRetry(history: RetryHistory, currentStoryId: string): boolean {
  return history.story_id === currentStoryId &&
    ["interrupted", "failed", "cancelled"].includes(history.state) &&
    Number.isSafeInteger(history.done) &&
    Number.isSafeInteger(history.total) &&
    history.total >= 1 && history.total <= 256 &&
    history.done >= 0 && history.done <= history.total;
}
