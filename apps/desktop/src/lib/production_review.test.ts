// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  canOfferManualRetry, freshAudioReview, recordSubtitleExport,
  reviewForAudio, reviewProgress, updateAudioReview,
} from "./production_review";

describe("transient, explicitly human-controlled WAV production review", () => {
  it("starts every new WAV with no automatic approval, even if an older WAV passed", () => {
    const first = freshAudioReview("wav-a");
    expect(reviewProgress(first, "wav-a")).toEqual({
      completed: 0, total: 4, personallyReviewed: false,
    });
    const heard = updateAudioReview(first, "wav-a", "listened_in_full", true);
    expect(reviewProgress(heard, "wav-a").completed).toBe(1);
    expect(reviewProgress(heard, "wav-b").completed).toBe(0);
    expect(reviewForAudio(heard, "wav-b").audioId).toBe("wav-b");
    expect(first.completed.listened_in_full).toBe(false);
  });

  it("requires actual SRT export before allowing an explicit subtitles check", () => {
    const audio = freshAudioReview("wav-a");
    expect(() => updateAudioReview(audio, "wav-a", "subtitles_reviewed", true))
      .toThrow("Export and inspect");
    const exported = recordSubtitleExport(audio, "wav-a");
    const checked = updateAudioReview(exported, "wav-a", "subtitles_reviewed", true);
    expect(checked.completed.subtitles_reviewed).toBe(true);
    expect(checked.subtitleExported).toBe(true);
    expect(audio.subtitleExported).toBe(false);
  });

  it("never interprets an export or synthesis success as human listening acceptance", () => {
    const start = recordSubtitleExport(null, "wav-a");
    expect(reviewProgress(start, "wav-a").completed).toBe(0);
    const listened = updateAudioReview(start, "wav-a", "listened_in_full", true);
    const pronunciation = updateAudioReview(listened, "wav-a", "pronunciation_reviewed", true);
    const roles = updateAudioReview(pronunciation, "wav-a", "character_turns_reviewed", true);
    expect(reviewProgress(roles, "wav-a").personallyReviewed).toBe(false);
    const captions = updateAudioReview(roles, "wav-a", "subtitles_reviewed", true);
    expect(reviewProgress(captions, "wav-a").personallyReviewed).toBe(true);
    expect(reviewProgress(updateAudioReview(captions, "wav-a", "listened_in_full", false), "wav-a")
      .personallyReviewed).toBe(false);
  });

  it("does not carry an SRT review to a different audio ID", () => {
    const checked = updateAudioReview(
      recordSubtitleExport(freshAudioReview("wav-a"), "wav-a"),
      "wav-a", "subtitles_reviewed", true,
    );
    expect(() => updateAudioReview(checked, "wav-b", "subtitles_reviewed", true))
      .toThrow("Export and inspect");
    expect(reviewForAudio(checked, "wav-b").subtitleExported).toBe(false);
  });
});

describe("explicit recovery history actions", () => {
  const base = { story_id: "story-a", state: "interrupted", done: 1, total: 3 };

  it("permits incomplete jobs only for the matching current story", () => {
    for (const state of ["interrupted", "failed", "cancelled"]) {
      expect(canOfferManualRetry({ ...base, state }, "story-a")).toBe(true);
    }
    expect(canOfferManualRetry(base, "story-b")).toBe(false);
    for (const state of ["running", "completed", "unknown"]) {
      expect(canOfferManualRetry({ ...base, state }, "story-a")).toBe(false);
    }
  });

  it("does not offer retry for corrupt or unbounded journal totals", () => {
    for (const example of [
      { done: -1, total: 2 }, { done: 3, total: 2 },
      { done: 0, total: 0 }, { done: 1, total: 257 },
      { done: Number.NaN, total: 3 }, { done: 1.1, total: 3 },
    ]) {
      expect(canOfferManualRetry({ ...base, ...example }, "story-a")).toBe(false);
    }
  });
});
