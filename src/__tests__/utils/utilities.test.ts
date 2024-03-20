import { describe, expect, test } from "@jest/globals";
import {
    hostToUnixPath,
    trimChars,
    unixToHostPath,
    valueFromString,
} from "../../utils/utilities.js";

describe("trimChars function", () => {
  test("trims the specified characters from the start and end of the string", () => {
    expect(trimChars("  hello  ", " ")).toBe("hello");
    expect(trimChars("  hello  ", " h")).toBe("ello");
    expect(trimChars("  hello  ", "eh")).toBe("  hello  ");
    expect(trimChars("  hello  ", "ehlo ")).toBe("");
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

describe("unixToHostPath", () => {
  test("converts a unix path to a host path", () => {
    expect(unixToHostPath("/mnt/c/")).toBe("c:\\");
    expect(unixToHostPath("/mnt/c/Users/")).toBe("c:\\Users\\");
    expect(unixToHostPath("/mnt/d/")).toBe("d:\\");
    expect(unixToHostPath("/mnt/d/Program Files/")).toBe("d:\\Program Files\\");
  });

  test("returns the input path if not a NAISYS path", () => {
    expect(unixToHostPath("c:\\")).toBe("c:\\");
    expect(unixToHostPath("c:\\Users\\")).toBe("c:\\Users\\");
    expect(unixToHostPath("d:\\")).toBe("d:\\");
    expect(unixToHostPath("d:\\Program Files\\")).toBe("d:\\Program Files\\");
  });
});

describe("hostToUnixPath", () => {
  test("converts a host path to a unix path", () => {
    expect(hostToUnixPath("c:\\")).toBe("/mnt/c/");
    expect(hostToUnixPath("c:\\Users\\")).toBe("/mnt/c/Users/");
    expect(hostToUnixPath("d:\\")).toBe("/mnt/d/");
    expect(hostToUnixPath("d:\\Program Files\\")).toBe("/mnt/d/Program Files/");
  });

  test("returns the input path if not a host path", () => {
    expect(hostToUnixPath("/mnt/c/")).toBe("/mnt/c/");
    expect(hostToUnixPath("/mnt/c/Users/")).toBe("/mnt/c/Users/");
    expect(hostToUnixPath("/mnt/d/")).toBe("/mnt/d/");
    expect(hostToUnixPath("/mnt/d/Program Files/")).toBe(
      "/mnt/d/Program Files/",
    );
  });
});
