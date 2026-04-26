import { describe, expect, test } from "vitest";

import { createOutputBuffer } from "../../command/outputBuffer.js";

describe("outputBuffer", () => {
  test("returns appended data unchanged when below head limit", () => {
    const buf = createOutputBuffer(100, 100);
    buf.append("hello ");
    buf.append("world");
    expect(buf.get()).toBe("hello world");
  });

  test("fills head exactly with no dropped marker", () => {
    const buf = createOutputBuffer(5, 10);
    buf.append("abcde");
    expect(buf.get()).toBe("abcde");
  });

  test("splits across head and tail without dropping", () => {
    const buf = createOutputBuffer(3, 10);
    buf.append("ABCxyz");
    expect(buf.get()).toBe("ABCxyz");
  });

  test("drops middle bytes once tail rolls over", () => {
    const buf = createOutputBuffer(2, 4);
    // Push enough to force a tail trim (tail trims at 2x = 8 bytes).
    buf.append("AB"); // fills head
    buf.append("0123456789"); // tail = "0123456789" (10 bytes, > 8) -> drops 6, tail = "6789"
    const out = buf.get();
    expect(out.startsWith("AB")).toBe(true);
    expect(out.endsWith("6789")).toBe(true);
    expect(out).toContain("bytes dropped");
  });

  test("stays bounded under runaway input (~96MB pushed)", () => {
    const headMax = 1024;
    const tailMax = 1024;
    const buf = createOutputBuffer(headMax, tailMax);
    const chunk = "x".repeat(64 * 1024); // 64KB
    for (let i = 0; i < 1500; i++) buf.append(chunk); // ~96MB total
    // Internal state must stay within head + 2*tail (the amortization ceiling).
    expect(buf.sizeBytes).toBeLessThanOrEqual(headMax + 2 * tailMax);
    // The final get() output should also be modest.
    expect(buf.get().length).toBeLessThan(headMax + 2 * tailMax + 200);
  });

  test("preserves head exactly across many appends", () => {
    const buf = createOutputBuffer(10, 5);
    buf.append("HEAD12");
    buf.append("3456");
    buf.append("aaaaaaaaaa"); // pushes well past head, into tail
    expect(buf.get().startsWith("HEAD123456")).toBe(true);
  });

  test("reset clears state", () => {
    const buf = createOutputBuffer(4, 4);
    buf.append("abcd");
    buf.append("0123456789"); // forces dropped
    buf.reset();
    expect(buf.get()).toBe("");
    expect(buf.sizeBytes).toBe(0);
    buf.append("fresh");
    expect(buf.get()).toBe("fresh");
  });

  test("dropped count accumulates correctly", () => {
    const buf = createOutputBuffer(0, 2);
    // Tail trims at 4 bytes (2x tailMax). After each trim, dropped += overflow.
    buf.append("12345"); // 5 bytes -> > 4, overflow = 3, tail = "45", dropped = 3
    buf.append("67890"); // tail = "4567890" (7 > 4), overflow = 5, tail = "90", dropped = 8
    const out = buf.get();
    expect(out).toContain("8 bytes dropped");
    expect(out.endsWith("90")).toBe(true);
  });
});
