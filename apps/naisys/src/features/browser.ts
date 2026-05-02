/**
 * Headless Chromium browser via Playwright.
 *
 * Fills the niche between ns-lynx (text-only) and ns-desktop (full GUI):
 * vision-capable models that need to interact with a web page but don't
 * need (or have) a real desktop. Visual mode (default) is screenshot + coord
 * clicks, mirroring ns-desktop's surface. Text mode keeps the
 * accessibility-tree + selector flow for cheaper deterministic browsing.
 */

import fs from "fs";
import path from "path";
import type { Browser, BrowserType, Page } from "playwright-core";
import stringArgv from "string-argv";

import type { AgentConfig } from "../agent/agentConfig.js";
import { browserCmd } from "../command/commandDefs.js";
import type { RegistrableCommand } from "../command/commandRegistry.js";
import { toPlaywrightKeyCombo } from "../computer-use/keyCombo.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { ContextManager } from "../llm/contextManager.js";
import { ContentSource } from "../llm/llmDtos.js";
import type { ModelService } from "../services/modelService.js";
import type { OutputService } from "../utils/output.js";
import { createPaginationState } from "./webPagination.js";

const CLEANUP_TIMEOUT_MS = 3000;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

type BrowserMode = "visual" | "text";

export function createBrowserService(
  { globalConfig }: GlobalConfig,
  agentConfig: AgentConfig,
  contextManager: ContextManager,
  output: OutputService,
  modelService: ModelService,
) {
  const pagination = createPaginationState();
  let chromium: BrowserType | null = null;
  let browser: Browser | null = null;
  let page: Page | null = null;
  const shellModel = modelService.getLlmModel(
    agentConfig.agentConfig().shellModel,
  );
  let mode: BrowserMode = shellModel.supportsVision ? "visual" : "text";

  function formatHelp(): string {
    const subs = browserCmd.subcommands!;
    const fmt = (name: keyof typeof subs) =>
      `  ${subs[name].usage.padEnd(48)}${subs[name].description}`;

    const lines = [
      `${browserCmd.name} <command>   (current mode: ${mode})`,
      "",
      "Common commands:",
      fmt("open"),
      fmt("back"),
      fmt("forward"),
      fmt("reload"),
      fmt("close"),
      fmt("screenshot"),
      fmt("type"),
      fmt("key"),
      fmt("mode"),
      "",
    ];

    if (mode === "visual") {
      lines.push("Visual mode commands (active):");
      lines.push(fmt("click"));
      lines.push(fmt("scroll"));
      lines.push("");
      lines.push(
        "Coordinates are in screenshot pixels (viewport is " +
          `${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}). After ` +
          "click/scroll/type/key, call `screenshot` to see updated state.",
      );
    } else {
      lines.push("Text mode commands (active):");
      lines.push(fmt("click"));
      lines.push(fmt("fill"));
      lines.push(fmt("text"));
      lines.push(fmt("more"));
      lines.push("");
      lines.push(
        "Selector syntax: 'text=Foo', '#id', '.cls', 'role=button[name=Sign in]'",
      );
    }

    return lines.join("\n");
  }

  async function loadChromium(): Promise<BrowserType> {
    if (chromium) return chromium;
    try {
      const mod = await import("playwright-core");
      chromium = mod.chromium;
      return chromium;
    } catch {
      throw "Playwright is not installed. Install with: npm install playwright-core && npx playwright install chromium";
    }
  }

  async function ensurePage(): Promise<Page> {
    if (page && !page.isClosed()) return page;

    if (!browser || !browser.isConnected()) {
      const cr = await loadChromium();
      output.commentAndLog("Launching headless Chromium...");
      try {
        browser = await cr.launch({ headless: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw `Failed to launch Chromium. You may need to run: npx playwright install chromium\n${msg}`;
      }
    }

    page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
    page.on("popup", (popup) => {
      handlePopup(popup).catch(() => {
        // Best-effort; the popup gets closed regardless.
      });
    });
    return page;
  }

  async function handlePopup(popup: Page): Promise<void> {
    // target=_blank links and window.open() create a new Page the agent can't
    // see. Log the URL and close it — they can `ns-browser open <url>` to
    // follow it explicitly if they want.
    let url = popup.url();
    if (!url || url === "about:blank") {
      try {
        await popup.waitForLoadState("domcontentloaded", { timeout: 3000 });
      } catch {
        // Fall through with whatever URL we have.
      }
      url = popup.url();
    }
    const shownUrl = url && url !== "about:blank" ? url : "(unknown URL)";
    contextManager.append(
      `Browser popup opened in new tab and was auto-closed: ${shownUrl}. ` +
        `To follow it, run: ${browserCmd.name} open ${shownUrl}`,
      ContentSource.Console,
    );
    await popup.close().catch(() => {
      // Already closed or detached.
    });
  }

  function getOperationTimeoutMs(): number {
    return globalConfig().shellCommand.timeoutSeconds * 1000;
  }

  async function withTimeout<T>(
    label: string,
    promise: Promise<T>,
  ): Promise<T> {
    const timeoutMs = getOperationTimeoutMs();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`${label} timed out after ${timeoutMs / 1000}s`),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function captureScreenshot(): Promise<{
    base64: string;
    filepath: string;
    url: string;
    title: string;
  }> {
    const p = await ensurePage();
    const url = p.url();
    const [title, buffer] = await Promise.all([
      withTimeout("title", p.title()),
      withTimeout("screenshot", p.screenshot({ fullPage: false })),
    ]);
    const base64 = buffer.toString("base64");
    const filepath = writeScreenshotFile(buffer);
    return { base64, filepath, url, title };
  }

  function writeScreenshotFile(buffer: Buffer): string {
    const dir = path.join(
      process.env.NAISYS_FOLDER || "",
      "tmp",
      "naisys",
      "browser-screenshots",
    );
    fs.mkdirSync(dir, { recursive: true });
    const filename = `browser-${Date.now()}.png`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  async function dumpVisual(): Promise<string> {
    const p = await ensurePage();
    if (!p.url() || p.url() === "about:blank") {
      return "No page loaded. Use 'ns-browser open <url>' first.";
    }
    // Visual output supersedes any prior text-mode pagination so a stale
    // `more` can't return chunks from a snapshot the page no longer reflects.
    pagination.clear();
    const shot = await captureScreenshot();
    const blockReason = contextManager.appendImage(
      shot.base64,
      "image/png",
      shot.filepath,
    );
    if (blockReason) return blockReason;
    return `URL: ${shot.url}\nTitle: ${shot.title}\nViewport: ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}`;
  }

  async function dumpText(): Promise<string> {
    const p = await ensurePage();
    const url = p.url();
    if (!url || url === "about:blank") {
      return "No page loaded. Use 'ns-browser open <url>' first.";
    }
    const [title, snapshot] = await Promise.all([
      withTimeout("title", p.title()),
      withTimeout("aria snapshot", p.locator("body").ariaSnapshot()),
    ]);
    const fullContent = `URL: ${url}\nTitle: ${title}\n\n${snapshot}`;

    const tokenMax = globalConfig().webTokenMax;
    const view = pagination.setContent(url, fullContent, tokenMax);
    let content = view.content;
    if (view.totalPages > 1) {
      content += `\n\n--- More content available. Use 'ns-browser more' to view page 2 of ${view.totalPages} ---`;
      output.comment(
        `Page is ${view.totalPages} pages. Showing page 1. Use 'ns-browser more' for next page.`,
      );
    }
    return content;
  }

  async function dumpCurrentPage(): Promise<string> {
    return mode === "visual" ? dumpVisual() : dumpText();
  }

  function handleMode(arg: string | undefined): string {
    if (!arg) return `Current mode: ${mode}`;
    const next = arg.toLowerCase();
    if (next !== "visual" && next !== "text") {
      throw `Unknown mode '${arg}'. Use 'visual' or 'text'.`;
    }
    mode = next;
    pagination.clear();
    return `Mode set to ${mode}.`;
  }

  async function handleOpen(url: string): Promise<string> {
    if (!url) throw `Usage: ${browserCmd.name} open <url>`;
    const p = await ensurePage();
    try {
      await withTimeout(
        "navigation",
        p.goto(url, { waitUntil: "domcontentloaded" }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw `Failed to load ${url}: ${msg}`;
    }
    return dumpCurrentPage();
  }

  async function handleNavigation(
    op: "back" | "forward" | "reload",
  ): Promise<string> {
    const p = await ensurePage();
    try {
      if (op === "back") await withTimeout(op, p.goBack());
      else if (op === "forward") await withTimeout(op, p.goForward());
      else await withTimeout(op, p.reload());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw `Failed to ${op}: ${msg}`;
    }
    return dumpCurrentPage();
  }

  async function handleScreenshot(): Promise<string> {
    const p = await ensurePage();
    if (!p.url() || p.url() === "about:blank") {
      return "No page loaded. Use 'ns-browser open <url>' first.";
    }
    const shot = await captureScreenshot();
    const blockReason = contextManager.appendImage(
      shot.base64,
      "image/png",
      shot.filepath,
    );
    if (blockReason) return blockReason;
    return `Screenshot captured: ${shot.filepath}`;
  }

  async function handleClick(argv: string[]): Promise<string> {
    if (mode === "visual") {
      // Validate before ensurePage() so bad usage doesn't cost a Chromium launch.
      const x = Number(argv[1]);
      const y = Number(argv[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw `Usage (visual mode): ${browserCmd.name} click <x> <y> [left|right|middle|double]`;
      }
      if (
        x < 0 ||
        y < 0 ||
        x >= DEFAULT_VIEWPORT.width ||
        y >= DEFAULT_VIEWPORT.height
      ) {
        throw `Click (${x}, ${y}) is outside the viewport bounds ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}.`;
      }
      const button = (argv[3] || "left").toLowerCase();
      const validButtons = ["left", "right", "middle", "double"];
      if (!validButtons.includes(button)) {
        throw `Unknown button "${button}". Use left, right, middle, or double.`;
      }
      const p = await ensurePage();
      try {
        if (button === "double") {
          await withTimeout("dblclick", p.mouse.dblclick(x, y));
        } else {
          await withTimeout(
            "click",
            p.mouse.click(x, y, {
              button: button as "left" | "right" | "middle",
            }),
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw `Failed to click (${x}, ${y}): ${msg}`;
      }
      // The visual click likely changed the DOM — invalidate any prior text
      // pagination so a later `more` can't return stale snapshot chunks.
      pagination.clear();
      return `Clicked (${button}) at (${x}, ${y})`;
    }

    // text mode
    const selector = argv[1];
    if (!selector) {
      throw `Usage (text mode): ${browserCmd.name} click "<selector>"`;
    }
    const p = await ensurePage();
    try {
      await withTimeout("click", p.click(selector));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw `Failed to click ${selector}: ${msg}`;
    }
    return dumpCurrentPage();
  }

  async function handleScroll(argv: string[]): Promise<string> {
    if (mode !== "visual") {
      throw `scroll is only available in visual mode. Switch with: ${browserCmd.name} mode visual`;
    }
    // Validate before ensurePage() so bad usage doesn't cost a Chromium launch.
    const direction = (argv[1] || "").toLowerCase();
    const pixels = Number(argv[2]);
    const validDirs = ["up", "down", "left", "right"];
    if (
      !validDirs.includes(direction) ||
      !Number.isFinite(pixels) ||
      pixels <= 0
    ) {
      throw `Usage: ${browserCmd.name} scroll <up|down|left|right> <pixels>`;
    }
    let dx = 0;
    let dy = 0;
    if (direction === "up") dy = -pixels;
    else if (direction === "down") dy = pixels;
    else if (direction === "left") dx = -pixels;
    else dx = pixels;

    const p = await ensurePage();
    try {
      await withTimeout("scroll", p.mouse.wheel(dx, dy));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw `Failed to scroll: ${msg}`;
    }
    // Scrolling reveals different content; any prior text pagination is now
    // disconnected from what the agent can see.
    pagination.clear();
    return `Scrolled ${direction} ${pixels}px`;
  }

  async function handleType(text: string): Promise<string> {
    if (!text) throw `Usage: ${browserCmd.name} type "<text>"`;
    const p = await ensurePage();
    try {
      await withTimeout("type", p.keyboard.type(text));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw `Failed to type: ${msg}`;
    }
    // Typing can trigger JS handlers that change the DOM — clear text-mode
    // pagination so a stale `more` can't return chunks from a pre-type snapshot.
    pagination.clear();
    return `Typed: ${text}`;
  }

  async function handleKey(combo: string): Promise<string> {
    if (!combo) throw `Usage: ${browserCmd.name} key <combo>`;
    // Playwright key names are case-sensitive (Enter, Tab, Control+A) — accept
    // the looser forms agents are likely to produce and normalize before press.
    const playwrightCombo = toPlaywrightKeyCombo(combo);
    if (!playwrightCombo) {
      throw `Unrecognized key combo: ${combo}`;
    }
    const p = await ensurePage();
    try {
      await withTimeout("key", p.keyboard.press(playwrightCombo));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw `Failed to press ${combo}: ${msg}`;
    }
    // A key press (especially Enter) can submit forms or navigate.
    pagination.clear();
    return `Pressed: ${combo}`;
  }

  async function handleFill(selector: string, text: string): Promise<string> {
    if (mode === "visual") {
      throw `fill is only available in text mode. Switch with: ${browserCmd.name} mode text`;
    }
    if (!selector || text === undefined) {
      throw `Usage: ${browserCmd.name} fill "<selector>" "<text>"`;
    }
    const p = await ensurePage();
    try {
      await withTimeout("fill", p.fill(selector, text));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw `Failed to fill ${selector}: ${msg}`;
    }
    pagination.clear();
    return `Filled: ${selector} = ${text}`;
  }

  async function handleText(): Promise<string> {
    return dumpText();
  }

  function handleMore(): string {
    if (!pagination.hasContent()) {
      return "No paginated content available. Use 'ns-browser text' (or 'open' in text mode) first.";
    }
    if (pagination.isAtLastPage()) {
      return `Already at the last page (${pagination.getTotalPages()}) of content for ${pagination.getLastUrl()}.`;
    }
    const view = pagination.next()!;
    let content = view.content;
    if (view.pageNum < view.totalPages) {
      content += `\n\n--- More content available. Use 'ns-browser more' to view page ${view.pageNum + 1} of ${view.totalPages} ---`;
    }
    return `URL: ${view.url} (Page ${view.pageNum} of ${view.totalPages})\n\n${content}`;
  }

  async function handleClose(): Promise<string> {
    if (page && !page.isClosed()) {
      await page.close();
    }
    page = null;
    pagination.clear();
    return "Page closed.";
  }

  async function handleCommand(cmdArgs: string): Promise<string> {
    const argv = stringArgv(cmdArgs);
    if (!argv[0]) argv[0] = "help";

    const sub = argv[0].toLowerCase();

    if (sub === "help") return formatHelp();

    if (!agentConfig.agentConfig().browserEnabled) {
      return `${browserCmd.name} is not enabled. Set 'browserEnabled: true' in the agent config.`;
    }

    switch (sub) {
      case "mode":
        return handleMode(argv[1]);
      case "open":
        return handleOpen(argv[1]);
      case "back":
      case "forward":
      case "reload":
        return handleNavigation(sub);
      case "close":
        return handleClose();
      case "screenshot":
        return handleScreenshot();
      case "click":
        return handleClick(argv);
      case "scroll":
        return handleScroll(argv);
      case "type":
        return handleType(argv.slice(1).join(" "));
      case "key":
        return handleKey(argv[1]);
      case "fill":
        return handleFill(argv[1], argv.slice(2).join(" "));
      case "text":
        return handleText();
      case "more":
        return handleMore();
      default:
        return `Unknown ${browserCmd.name} subcommand '${argv[0]}'. See valid commands below:\n${formatHelp()}`;
    }
  }

  function clear(): void {
    pagination.clear();
  }

  async function cleanup(): Promise<void> {
    if (!browser) return;
    const browserToClose = browser;
    browser = null;
    page = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        browserToClose.close(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, CLEANUP_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // OS will reap the orphan if close hangs.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const registrableCommand: RegistrableCommand = {
    command: browserCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
    clear,
    cleanup,
  };
}

export type BrowserService = ReturnType<typeof createBrowserService>;
