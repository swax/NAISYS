import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createEscKeyListener } from "../../utils/escKeyListener.js";

describe("escKeyListener", () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalIsRaw = process.stdin.isRaw;

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdin, "isRaw", {
      configurable: true,
      writable: true,
      value: false,
    });
    Object.defineProperty(process.stdin, "setRawMode", {
      configurable: true,
      writable: true,
      value: vi.fn((enabled: boolean) => {
        Object.defineProperty(process.stdin, "isRaw", {
          configurable: true,
          writable: true,
          value: enabled,
        });
        return process.stdin;
      }),
    });
    Object.defineProperty(process.stdin, "resume", {
      configurable: true,
      writable: true,
      value: vi.fn(() => process.stdin),
    });
    Object.defineProperty(process.stdin, "pause", {
      configurable: true,
      writable: true,
      value: vi.fn(() => process.stdin),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
    Object.defineProperty(process.stdin, "isRaw", {
      configurable: true,
      writable: true,
      value: originalIsRaw,
    });
  });

  test("re-emits SIGINT when ctrl+c is pressed during raw listening", () => {
    const emitSpy = vi.spyOn(process, "emit");

    const stop = createEscKeyListener().start(() => {});
    process.stdin.emit("data", Buffer.from("\x03"));
    stop();

    expect(emitSpy).toHaveBeenCalledWith("SIGINT", "SIGINT");
  });
});
