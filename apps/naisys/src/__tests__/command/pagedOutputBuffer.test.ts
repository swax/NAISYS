import { describe, expect, test } from "vitest";

import {
  breakContentIntoPages,
  createPagedOutputBuffer,
} from "../../command/pagedOutputBuffer.js";
import type { GlobalConfig } from "../../globalConfig.js";
import { createMockGlobalConfig } from "../mocks.js";

/** True if the string contains a UTF-16 surrogate code unit without its
 *  matching partner — the shape that serializes to invalid JSON. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true; // high without low
      i++; // valid pair — skip the low half
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true; // low without preceding high
    }
  }
  return false;
}

function buildBuffer(outputTokenMax = 4) {
  const base = createMockGlobalConfig();
  const globalConfig = {
    ...base,
    globalConfig: () => ({
      ...base.globalConfig(),
      shellCommand: {
        ...base.globalConfig().shellCommand,
        outputTokenMax,
      },
    }),
  } satisfies GlobalConfig;

  return createPagedOutputBuffer(globalConfig);
}

function longContent(marker: string): string {
  return `${marker} ${Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ")}`;
}

describe("pagedOutputBuffer", () => {
  test("does not store output that fits within the token budget", () => {
    const buf = buildBuffer(1000);
    const content = "short output";

    expect(buf.setContent("curl https://example.com", content)).toBe(content);
    expect(buf.size()).toBe(0);
    expect(buf.moreCommand.handleCommand("curl-1 --page=2")).toContain(
      'No buffered output matching "curl-1"',
    );
  });

  test("allocates shell-safe ids from sanitized first words", () => {
    const buf = buildBuffer();

    const firstPage = buf.setContent("~/Bin/Tool --flag", longContent("tool"));

    expect(firstPage).toContain("ns-more bin-tool-1 --page=2");
    const secondPage = buf.moreCommand.handleCommand("bin-tool-1 --page=2");
    expect(secondPage).toContain("Source: ~/Bin/Tool --flag");
    expect(secondPage).not.toContain("No buffered output matching");
  });

  test("uses exact ids for duplicate commands and bare stem for most recent", () => {
    const buf = buildBuffer();

    const oldFirstPage = buf.setContent(
      "curl https://example.com",
      longContent("old"),
    );
    const newFirstPage = buf.setContent(
      "curl https://example.com",
      longContent("new"),
    );

    expect(oldFirstPage).toContain("ns-more curl-1 --page=2");
    expect(newFirstPage).toContain("ns-more curl-2 --page=2");

    expect(buf.moreCommand.handleCommand("curl-1 --page=first")).toContain(
      "old",
    );
    expect(buf.moreCommand.handleCommand("curl-2 --page=first")).toContain(
      "new",
    );
    expect(buf.moreCommand.handleCommand("curl --page=first")).toContain("new");
  });

  test("supports default next page and clamps page requests", () => {
    const buf = buildBuffer();

    buf.setContent("npm test", longContent("npm"));

    const defaultPage = buf.moreCommand.handleCommand("npm-1");
    expect(defaultPage).toContain("Source: npm test (page 2 of");

    const firstPage = buf.moreCommand.handleCommand("npm-1 --page=0");
    expect(firstPage).toContain("Source: npm test (page 1 of");

    const lastPage = buf.moreCommand.handleCommand("npm-1 --page=9999");
    expect(lastPage).toContain("No more pages.");
  });

  test("never splits a surrogate pair across page boundaries", () => {
    // Dense non-BMP content: every grinning-face emoji is a 2-code-unit pair,
    // so a naive code-unit cut lands mid-pair on roughly half of all offsets.
    const content = "😀".repeat(1000);
    const pages = breakContentIntoPages(content, 4);

    expect(pages.length).toBeGreaterThan(1);
    // Lossless: concatenating the pages reproduces the input exactly.
    expect(pages.join("")).toBe(content);
    // Each page is on its own valid UTF-16 — no orphaned surrogate halves.
    for (const page of pages) {
      expect(hasLoneSurrogate(page)).toBe(false);
    }
  });

  test("keeps pairs whole when an ASCII prefix shifts the cut parity", () => {
    // The leading "x" offsets every pair by one code unit, so cuts that were
    // clean without it now land mid-pair — covers the opposite boundary parity.
    const content = "x" + "😀".repeat(1000);
    const pages = breakContentIntoPages(content, 4);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join("")).toBe(content);
    for (const page of pages) {
      expect(hasLoneSurrogate(page)).toBe(false);
    }
  });

  test("clear drops entries and resets id counters", () => {
    const buf = buildBuffer();

    buf.setContent("curl https://example.com", longContent("old"));
    expect(buf.size()).toBe(1);

    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.moreCommand.handleCommand("curl-1 --page=2")).toContain(
      'No buffered output matching "curl-1"',
    );

    const firstPageAfterClear = buf.setContent(
      "curl https://example.com",
      longContent("new"),
    );
    expect(firstPageAfterClear).toContain("ns-more curl-1 --page=2");
  });
});
