import { describe, expect, test } from "@jest/globals";
import { HostPath, NaisysPath } from "../../utils/pathService.js";

function naisysToHostPath(path: string): string {
  return new NaisysPath(path).toHostPath();
}

function hostToNaisysPath(path: string): string {
  return new HostPath(path).toNaisysPath();
}

describe("NaisysPath::toHostPath", () => {
  test("converts a unix path to a host path", () => {
    expect(naisysToHostPath("/mnt/c/")).toBe("c:\\");
    expect(naisysToHostPath("/mnt/c/Users/")).toBe("c:\\Users\\");
    expect(naisysToHostPath("/mnt/d/")).toBe("d:\\");
    expect(naisysToHostPath("/mnt/d/Program Files/")).toBe(
      "d:\\Program Files\\",
    );
  });

  test("returns the input path if not a NAISYS path", () => {
    expect(naisysToHostPath("c:\\")).toBe("c:\\");
    expect(naisysToHostPath("c:\\Users\\")).toBe("c:\\Users\\");
    expect(naisysToHostPath("d:\\")).toBe("d:\\");
    expect(naisysToHostPath("d:\\Program Files\\")).toBe("d:\\Program Files\\");
  });
});

describe("HostPath::toNaisysPath", () => {
  test("converts a host path to a unix path", () => {
    expect(hostToNaisysPath("c:\\")).toBe("/mnt/c/");
    expect(hostToNaisysPath("c:\\Users\\")).toBe("/mnt/c/Users/");
    expect(hostToNaisysPath("d:\\")).toBe("/mnt/d/");
    expect(hostToNaisysPath("d:\\Program Files\\")).toBe(
      "/mnt/d/Program Files/",
    );
  });

  test("returns the input path if not a host path", () => {
    expect(hostToNaisysPath("/mnt/c/")).toBe("/mnt/c/");
    expect(hostToNaisysPath("/mnt/c/Users/")).toBe("/mnt/c/Users/");
    expect(hostToNaisysPath("/mnt/d/")).toBe("/mnt/d/");
    expect(hostToNaisysPath("/mnt/d/Program Files/")).toBe(
      "/mnt/d/Program Files/",
    );
  });
});
