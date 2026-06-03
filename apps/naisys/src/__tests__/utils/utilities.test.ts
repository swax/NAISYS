import { valueFromString } from "@naisys/common";
import { describe, expect, test } from "vitest";

import {
  surrogateSafeEnd,
  surrogateSafeStart,
  trimChars,
} from "../../utils/utilities.js";

// "😀" (U+1F600) is the surrogate pair 0xD83D 0xDE00.
const HI = "\ud83d";
const LO = "\ude00";

describe("trimChars function", () => {
  test("trims the specified characters from the start and end of the string", () => {
    expect(trimChars("  hello  ", " ")).toBe("hello");
    expect(trimChars("  hello  ", " h")).toBe("ello");
    expect(trimChars("  hello  ", "eh")).toBe("  hello  ");
    expect(trimChars("  hello  ", "ehlo ")).toBe("");
  });
});

describe("surrogateSafeEnd", () => {
  test("backs a cut off a lone high surrogate so the pair stays whole", () => {
    const text = "a" + HI + LO + "b"; // a 😀 b
    // Cutting at index 2 would put the high surrogate at the end of the slice.
    expect(surrogateSafeEnd(text, 2)).toBe(1);
  });

  test("leaves cuts that don't split a pair untouched", () => {
    const text = "a" + HI + LO + "b";
    expect(surrogateSafeEnd(text, 1)).toBe(1); // before the pair
    expect(surrogateSafeEnd(text, 3)).toBe(3); // after the pair
  });

  test("does not touch a trailing high surrogate at the very end", () => {
    // end === length: the string ends here naturally; nothing follows to split.
    const text = "a" + HI;
    expect(surrogateSafeEnd(text, 2)).toBe(2);
  });
});

describe("surrogateSafeStart", () => {
  test("advances past a lone low surrogate left by a front trim", () => {
    const text = HI + LO + "b"; // 😀 b — dropping index 0 strands the low half
    expect(surrogateSafeStart(text, 1)).toBe(2);
  });

  test("leaves clean start boundaries untouched", () => {
    const text = "a" + HI + LO + "b";
    expect(surrogateSafeStart(text, 1)).toBe(1); // starts on the high half
    expect(surrogateSafeStart(text, 3)).toBe(3); // starts on "b"
  });
});

describe("valueFromString function", () => {
  const obj = {
    user: {
      name: "John Doe",
      contact: {
        email: "john@example.com",
        phone: {
          home: "123456",
          work: "789101",
        },
      },
    },
  };

  test("retrieves a nested value successfully", () => {
    expect(valueFromString(obj, "user.name")).toBe("John Doe");
    expect(valueFromString(obj, "user.contact.email")).toBe("john@example.com");
    expect(valueFromString(obj, "user.contact.phone.home")).toBe("123456");
  });

  test("returns undefined for non-existent path", () => {
    expect(valueFromString(obj, "user.address")).toBeUndefined();
  });

  test("returns default value for non-existent path when specified", () => {
    const defaultValue = "N/A";
    expect(valueFromString(obj, "user.age", defaultValue)).toBe(defaultValue);
  });

  test("handles non-object inputs gracefully", () => {
    expect(valueFromString(null, "user.name")).toBeUndefined();
    expect(valueFromString(undefined, "user.name")).toBeUndefined();
    expect(valueFromString("not-an-object", "user.name")).toBeUndefined();
  });

  test("deals with edge cases for paths", () => {
    expect(valueFromString(obj, "")).toEqual(obj);
    expect(valueFromString(obj, ".", "default")).toBe("default");
  });

  test("handles empty object and non-matching paths", () => {
    expect(valueFromString({}, "user.name")).toBeUndefined();
    expect(valueFromString(obj, "user.nonexistent.prop", "default")).toBe(
      "default",
    );
  });
});
