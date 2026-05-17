/**
 * Per-agent FIFO ring of over-budget command outputs, addressable by an
 * auto-assigned `<firstWord>-<N>` id (e.g. `curl-1`, `ns-lynx-2`) via
 * `ns-more`. Cleared — entries and id counters — on session compaction.
 */

import stringArgv from "string-argv";

import type { GlobalConfig } from "../globalConfig.js";
import * as utilities from "../utils/utilities.js";
import { moreCmd } from "./commandDefs.js";
import type { RegistrableCommand } from "./commandRegistry.js";

interface BufferEntry {
  id: string;
  firstWord: string;
  label: string;
  pages: string[];
}

const BUFFER_CAPACITY = 25;
const SOURCE_DISPLAY_MAX = 80;

function breakContentIntoPages(
  content: string,
  tokensPerPage: number,
): string[] {
  const totalTokens = utilities.getTokenCount(content);
  if (totalTokens <= tokensPerPage) {
    return [content];
  }

  const charactersPerToken = content.length / totalTokens;
  const charactersPerPage = Math.ceil(tokensPerPage * charactersPerToken);

  const pages: string[] = [];
  let startIndex = 0;
  while (startIndex < content.length) {
    const endIndex = Math.min(startIndex + charactersPerPage, content.length);
    pages.push(content.substring(startIndex, endIndex));
    startIndex = endIndex;
  }
  return pages;
}

function truncateLabel(label: string): string {
  return label.length > SOURCE_DISPLAY_MAX
    ? label.slice(0, SOURCE_DISPLAY_MAX - 3) + "..."
    : label;
}

/** Reduce the first word to a shell-safe stem so the id round-trips through
 *  expandShellArgs unchanged (`~`, `$VAR`, quotes get neutralized at
 *  allocation; the footer-displayed id is what the LLM should type back). */
function sanitizeStem(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function createPagedOutputBuffer({ globalConfig }: GlobalConfig) {
  // Newest at index 0 so most-recent lookup is a forward scan.
  const entries: BufferEntry[] = [];
  // Per-firstWord monotonic counter. Reset on clear() — ids only make sense
  // within the lifetime of a single uncompacted buffer.
  const counters = new Map<string, number>();

  function headerFor(entry: BufferEntry, pageNum: number): string {
    return `Source: ${truncateLabel(entry.label)} (page ${pageNum} of ${entry.pages.length})`;
  }

  function footerFor(entry: BufferEntry, pageNum: number): string {
    const totalPages = entry.pages.length;
    if (pageNum >= totalPages) return "No more pages.";
    return `Use \`ns-more ${entry.id} --page=${pageNum + 1}\` for page ${pageNum + 1} of ${totalPages}.`;
  }

  /**
   * `label` should be the raw command the agent issued. The first word becomes
   * the id prefix. Returns page 1 already framed (or the raw content when it
   * fits in one page and isn't stored).
   */
  function setContent(label: string, content: string): string {
    const pages = breakContentIntoPages(
      content,
      globalConfig().shellCommand.outputTokenMax,
    );
    if (pages.length <= 1) return content;

    const stem = sanitizeStem(label.trim().split(/\s+/)[0] ?? "") || "cmd";
    const nextN = (counters.get(stem) ?? 0) + 1;
    counters.set(stem, nextN);

    const entry: BufferEntry = {
      id: `${stem}-${nextN}`,
      firstWord: stem,
      label,
      pages,
    };
    entries.unshift(entry);
    if (entries.length > BUFFER_CAPACITY) {
      entries.length = BUFFER_CAPACITY;
    }

    // Page 1 is the inline response to the command the agent just ran — no
    // header needed (they know what command produced this). ns-more paging
    // adds the header so re-fetched pages identify themselves.
    return `${pages[0]}\n\n${footerFor(entry, 1)}`;
  }

  /** Resolve `<stem>` (most recent) or `<stem>-<N>` (exact id). */
  function findByKey(key: string): BufferEntry | null {
    const k = key.toLowerCase();
    if (/^.+-\d+$/.test(k)) {
      return entries.find((e) => e.id === k) ?? null;
    }
    // Bare stem — return most recent (entries are newest-first).
    return entries.find((e) => e.firstWord === k) ?? null;
  }

  function helpText(): string {
    return [
      "ns-more — page through over-budget command output.",
      "",
      "Usage:",
      "  ns-more                       Show this help",
      "  ns-more <id> --page=<N>       Specific page",
      "",
      "Each paged response footer shows the entry's id and the next-page invocation.",
      `Buffer holds the last ${BUFFER_CAPACITY} over-budget outputs (FIFO); cleared on compaction.`,
    ].join("\n");
  }

  function handleCommand(cmdArgs: string): string {
    const argv = stringArgv(cmdArgs);

    if (argv.length === 0) return helpText();

    // Reject leading flag: an id is always required so the LLM is forced to
    // say which buffer it's paging.
    const first = argv[0];
    if (first.startsWith("--")) {
      return `Specify an id first: \`ns-more <id> ${first}\`. See \`ns-more\` for help.`;
    }

    if (argv.length > 2) {
      return `Too many arguments. Usage: \`ns-more <id> [--page=<N>]\`.`;
    }

    const entry = findByKey(first);
    if (!entry) {
      return `No buffered output matching "${first}".`;
    }

    // Default page 2 — the agent already saw page 1 from the original command.
    // Accept either the advertised `--page=N` flag or a bare value (number /
    // first / last) for ergonomics.
    let pageNum: number;
    const pageArg = argv[1];
    if (pageArg === undefined) {
      pageNum = 2;
    } else {
      const value = /^--page=(.+)$/.exec(pageArg)?.[1] ?? pageArg;
      if (/^first$/i.test(value)) {
        pageNum = 1;
      } else if (/^last$/i.test(value)) {
        pageNum = entry.pages.length;
      } else if (/^-?\d+$/.test(value)) {
        pageNum = parseInt(value, 10);
      } else {
        return `Expected --page=<N>. Got: "${pageArg}".`;
      }
    }

    // Clamp silently — the footer reports the actual landing page.
    if (pageNum < 1) pageNum = 1;
    if (pageNum > entry.pages.length) pageNum = entry.pages.length;

    return `${headerFor(entry, pageNum)}\n\n${entry.pages[pageNum - 1]}\n\n${footerFor(entry, pageNum)}`;
  }

  function clear(): void {
    entries.length = 0;
    counters.clear();
  }

  /** Test-only. */
  function size(): number {
    return entries.length;
  }

  const moreCommand: RegistrableCommand = {
    command: moreCmd,
    handleCommand,
  };

  return {
    setContent,
    clear,
    size,
    moreCommand,
  };
}

export type PagedOutputBuffer = ReturnType<typeof createPagedOutputBuffer>;
