// SPDX-License-Identifier: MPL-2.0
/**
 * Recognized text and edited transcript reviews must not include invisible
 * Unicode direction controls that could make visible Hindi text differ from
 * the saved reading order. Deliberately preserve U+200C/U+200D: these are
 * Indic joiners used for legitimate Devanagari shaping, not bidi overrides.
 * Reject rather than rewriting a model result or private user edit.
 */
const UNSAFE_STT_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/u;

export function hasUnsafeSttTextControls(text: string): boolean {
  return UNSAFE_STT_CONTROLS.test(text);
}
