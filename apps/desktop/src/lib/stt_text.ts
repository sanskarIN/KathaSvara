// SPDX-License-Identifier: MPL-2.0
/**
 * Recognized text and edited transcript reviews must not include invisible
 * direction and non-rendering format controls that could make visible Hindi
 * text differ from stored words (including soft hyphen, zero-width space,
 * word joiner, BOM and deprecated bidi controls). Preserve U+200C/U+200D: these are
 * Indic joiners used for legitimate Devanagari shaping, not bidi overrides.
 * Reject rather than rewriting a model result or private user edit.
 * Lone UTF-16 surrogates are also invalid; the Unicode-mode regex preserves
 * valid astral characters (including paired surrogate emoji).
 */
const UNSAFE_STT_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u200b\u200e-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ud800-\udfff]/u;

export function hasUnsafeSttTextControls(text: string): boolean {
  return UNSAFE_STT_CONTROLS.test(text);
}

/**
 * A user-initiated repair action, never called automatically on model output
 * or on paste. Explicitly removes only the same rejected control code points
 * and leaves Devanagari joiners and ordinary spaces/marks untouched.
 */
export function removeUnsafeSttTextControls(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u200b\u200e-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ud800-\udfff]/gu, "");
}
