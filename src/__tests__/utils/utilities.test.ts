import { describe, expect, test } from "@jest/globals";
import { valueFromString } from "../../utils/utilities.js";

describe("valueFromString", () => {
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
