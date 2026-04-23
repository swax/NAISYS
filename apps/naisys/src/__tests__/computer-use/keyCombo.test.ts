import { describe, expect, test } from "vitest";

import {
  canonicalizeKeyCombo,
  normalizeKeyCombo,
} from "../../computer-use/keyCombo.js";

describe("keyCombo normalization", () => {
  test("normalizes aliases and casing into canonical key chords", () => {
    expect(
      normalizeKeyCombo(
        "up Return esc BackSpace del page_up PGDN ctrl+cmd+T",
      ),
    ).toEqual([
      { modifiers: [], keys: ["up"] },
      { modifiers: [], keys: ["enter"] },
      { modifiers: [], keys: ["escape"] },
      { modifiers: [], keys: ["backspace"] },
      { modifiers: [], keys: ["delete"] },
      { modifiers: [], keys: ["pageup"] },
      { modifiers: [], keys: ["pagedown"] },
      { modifiers: ["ctrl", "meta"], keys: ["t"] },
    ]);
  });

  test("preserves unknown multi-character keys while canonicalizing letters", () => {
    expect(normalizeKeyCombo("A F12 XF86AudioMute")).toEqual([
      { modifiers: [], keys: ["a"] },
      { modifiers: [], keys: ["f12"] },
      { modifiers: [], keys: ["XF86AudioMute"] },
    ]);
  });

  test("canonicalizes a key combo string for semantic comparisons", () => {
    expect(canonicalizeKeyCombo("Return alt+Left PGDN")).toBe(
      "enter alt+left pagedown",
    );
  });
});
