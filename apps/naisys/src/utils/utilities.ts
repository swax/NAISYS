import { get_encoding } from "tiktoken";

const _gpt2encoding = get_encoding("gpt2");

export function getTokenCount(text: string) {
  return _gpt2encoding.encode(text).length;
}

export function trimChars(text: string, charList: string) {
  return text.replace(new RegExp(`^[${charList}]+|[${charList}]+$`, "g"), "");
}

// A non-BMP character (emoji, CJK extension, etc.) is stored as a UTF-16
// surrogate pair: a high surrogate (0xD800–0xDBFF) followed by a low surrogate
// (0xDC00–0xDFFF). Slicing a string by code-unit index can land between the two
// halves, leaving a lone surrogate that serializes to invalid JSON — the
// Anthropic API rejects it with "no low surrogate in string". These helpers
// nudge a cut point off a surrogate boundary so pairs stay whole.

/** Adjust an exclusive end-cut index so the slice doesn't end on a lone high
 *  surrogate, pushing the whole pair into the following slice instead. */
export function surrogateSafeEnd(text: string, end: number) {
  if (end > 0 && end < text.length) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) return end - 1;
  }
  return end;
}

/** Adjust a start-cut index so the slice doesn't begin on a lone low surrogate,
 *  dropping the orphaned half (its high surrogate is already being dropped). */
export function surrogateSafeStart(text: string, start: number) {
  if (start > 0 && start < text.length) {
    const code = text.charCodeAt(start);
    if (code >= 0xdc00 && code <= 0xdfff) return start + 1;
  }
  return start;
}

export function shuffle<T>(array: T[]) {
  // Create a copy of the array to shuffle
  const shuffled = array.slice();

  for (let i = shuffled.length - 1; i > 0; i--) {
    // Pick a random index from 0 to i
    const j = Math.floor(Math.random() * (i + 1));

    // Swap elements shuffled[i] and shuffled[j]
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}
