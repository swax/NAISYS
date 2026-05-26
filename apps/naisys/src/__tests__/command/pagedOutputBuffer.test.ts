import { describe, expect, test } from "vitest";

import { createPagedOutputBuffer } from "../../command/pagedOutputBuffer.js";
import type { GlobalConfig } from "../../globalConfig.js";
import { createMockGlobalConfig } from "../mocks.js";

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
