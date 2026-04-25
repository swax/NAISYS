import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { createBrowserService } from "../../features/browser.js";
import {
  createMockContextManager,
  createMockGlobalConfig,
  createMockOutputService,
} from "../mocks.js";

// Isolate browser screenshot writes to a per-run temp dir so tests don't
// leak PNG files into the repo's working tree.
const TEST_NAISYS_FOLDER = fs.mkdtempSync(
  path.join(os.tmpdir(), "naisys-browser-test-"),
);
let originalNaisysFolder: string | undefined;

beforeAll(() => {
  originalNaisysFolder = process.env.NAISYS_FOLDER;
  process.env.NAISYS_FOLDER = TEST_NAISYS_FOLDER;
});

afterAll(() => {
  if (originalNaisysFolder === undefined) delete process.env.NAISYS_FOLDER;
  else process.env.NAISYS_FOLDER = originalNaisysFolder;
  fs.rmSync(TEST_NAISYS_FOLDER, { recursive: true, force: true });
});

const launchMock = vi.fn();

vi.mock("playwright-core", () => ({
  chromium: {
    launch: (...args: unknown[]) => launchMock(...args),
  },
}));

function makeAgentConfig(browserEnabled: boolean) {
  return {
    agentConfig: () => ({ browserEnabled, shellModel: "shell-model" }) as any,
  } as any;
}

function makeModelService(supportsVision = true) {
  return {
    getLlmModel: vi.fn(() => ({ supportsVision })),
  } as any;
}

interface MockPageOverrides {
  url?: string;
  title?: string;
  ariaSnapshot?: string | (() => Promise<string>);
}

function makeMockPage(overrides: MockPageOverrides = {}) {
  const url = vi.fn(() => overrides.url ?? "https://example.com");
  const title = vi.fn(() => Promise.resolve(overrides.title ?? "Example"));
  const ariaSnapshot =
    typeof overrides.ariaSnapshot === "function"
      ? vi.fn(overrides.ariaSnapshot)
      : vi.fn(() => Promise.resolve(overrides.ariaSnapshot ?? "- text"));
  const locator = vi.fn(() => ({ ariaSnapshot }));
  const goto = vi.fn(() => Promise.resolve(null));
  const click = vi.fn(() => Promise.resolve());
  const fill = vi.fn(() => Promise.resolve());
  const goBack = vi.fn(() => Promise.resolve(null));
  const goForward = vi.fn(() => Promise.resolve(null));
  const reload = vi.fn(() => Promise.resolve(null));
  const screenshot = vi.fn(() => Promise.resolve(Buffer.from("png-bytes")));
  const close = vi.fn(() => Promise.resolve());
  const isClosed = vi.fn(() => false);
  const mouse = {
    click: vi.fn(() => Promise.resolve()),
    dblclick: vi.fn(() => Promise.resolve()),
    wheel: vi.fn(() => Promise.resolve()),
  };
  const keyboard = {
    type: vi.fn(() => Promise.resolve()),
    press: vi.fn(() => Promise.resolve()),
  };
  const page = {
    url,
    title,
    locator,
    goto,
    click,
    fill,
    goBack,
    goForward,
    reload,
    screenshot,
    close,
    isClosed,
    mouse,
    keyboard,
  };
  return { page, ariaSnapshot };
}

function mockLaunch(page: ReturnType<typeof makeMockPage>["page"]) {
  launchMock.mockResolvedValue({
    newPage: vi.fn(() => Promise.resolve(page)),
    isConnected: () => true,
    close: vi.fn(() => Promise.resolve()),
  });
}

function makeService(browserEnabled = true, supportsVision = true) {
  return createBrowserService(
    createMockGlobalConfig(),
    makeAgentConfig(browserEnabled),
    createMockContextManager(),
    createMockOutputService(),
    makeModelService(supportsVision),
  );
}

beforeEach(() => {
  launchMock.mockReset();
});

describe("ns-browser help and gating", () => {
  test("help is available even when disabled, defaults to visual mode", async () => {
    const svc = makeService(false);
    const result = await svc.handleCommand("help");
    expect(result).toContain("ns-browser <command>");
    expect(result).toContain("current mode: visual");
    expect(result).toContain("Visual mode commands");
    expect(result).toContain("click <x> <y>");
    expect(result).toContain("scroll <up|down|left|right>");
  });

  test("help in text mode shows selector commands", async () => {
    const svc = makeService(true);
    await svc.handleCommand("mode text");
    const result = await svc.handleCommand("help");
    expect(result).toContain("current mode: text");
    expect(result).toContain("Text mode commands");
    expect(result).toContain("Selector syntax");
  });

  test("defaults to text mode when shell model lacks vision support", async () => {
    const svc = makeService(true, false);
    const result = await svc.handleCommand("help");
    expect(result).toContain("current mode: text");
    expect(result).toContain("Text mode commands");
  });

  test("returns disabled message when flag is off", async () => {
    const svc = makeService(false);
    const result = await svc.handleCommand("open https://example.com");
    expect(result).toContain("not enabled");
    expect(launchMock).not.toHaveBeenCalled();
  });

  test("unknown subcommand returns help", async () => {
    const svc = makeService(true);
    const result = await svc.handleCommand("flibbertigibbet");
    expect(result).toContain("Unknown ns-browser subcommand 'flibbertigibbet'");
  });

  test("missing url throws usage error", async () => {
    const svc = makeService(true);
    await expect(svc.handleCommand("open")).rejects.toContain("Usage:");
    expect(launchMock).not.toHaveBeenCalled();
  });

  test("more without prior open returns helpful message", async () => {
    const svc = makeService(true);
    const result = await svc.handleCommand("more");
    expect(result).toContain("No paginated content available");
  });
});

describe("ns-browser mode switching", () => {
  test("`mode` with no arg returns current mode", async () => {
    const svc = makeService(true);
    expect(await svc.handleCommand("mode")).toBe("Current mode: visual");
  });

  test("`mode text` switches and clears pagination", async () => {
    const svc = makeService(true);
    expect(await svc.handleCommand("mode text")).toBe("Mode set to text.");
    expect(await svc.handleCommand("mode")).toBe("Current mode: text");
  });

  test("invalid mode arg throws", async () => {
    const svc = makeService(true);
    await expect(svc.handleCommand("mode banana")).rejects.toContain(
      "Unknown mode",
    );
  });
});

describe("ns-browser visual mode (default)", () => {
  test("open returns a screenshot and URL/title metadata", async () => {
    const { page } = makeMockPage({ title: "Example Domain" });
    mockLaunch(page);

    const svc = makeService(true);
    const result = await svc.handleCommand("open https://example.com");
    expect(launchMock).toHaveBeenCalledWith({ headless: true });
    expect(page.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "domcontentloaded",
    });
    expect(page.screenshot).toHaveBeenCalled();
    expect(result).toContain("URL: https://example.com");
    expect(result).toContain("Title: Example Domain");
    expect(result).toContain("Viewport: 1280x720");
  });

  test("click <x> <y> calls page.mouse.click with coords", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    const result = await svc.handleCommand("click 400 300");
    expect(page.mouse.click).toHaveBeenCalledWith(400, 300, { button: "left" });
    expect(result).toBe("Clicked (left) at (400, 300)");
  });

  test("click double routes to dblclick", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    await svc.handleCommand("click 100 200 double");
    expect(page.mouse.dblclick).toHaveBeenCalledWith(100, 200);
  });

  test("click without coords throws visual usage error", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    await expect(svc.handleCommand("click")).rejects.toContain(
      "Usage (visual mode)",
    );
  });

  test("scroll down calls page.mouse.wheel with positive deltaY", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    const result = await svc.handleCommand("scroll down 500");
    expect(page.mouse.wheel).toHaveBeenCalledWith(0, 500);
    expect(result).toBe("Scrolled down 500px");
  });

  test("scroll up uses negative deltaY", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    await svc.handleCommand("scroll up 200");
    expect(page.mouse.wheel).toHaveBeenCalledWith(0, -200);
  });

  test("scroll with bad direction throws", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    await expect(svc.handleCommand("scroll diagonal 100")).rejects.toContain(
      "Usage:",
    );
  });

  test("type calls page.keyboard.type", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    const result = await svc.handleCommand('type "hello world"');
    expect(page.keyboard.type).toHaveBeenCalledWith("hello world");
    expect(result).toBe("Typed: hello world");
  });

  test("key calls page.keyboard.press", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    const result = await svc.handleCommand("key Enter");
    expect(page.keyboard.press).toHaveBeenCalledWith("Enter");
    expect(result).toBe("Pressed: Enter");
  });

  test("key normalizes lowercase to Playwright case-sensitive form", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    await svc.handleCommand("key enter");
    expect(page.keyboard.press).toHaveBeenCalledWith("Enter");
    await svc.handleCommand("key ctrl+a");
    expect(page.keyboard.press).toHaveBeenCalledWith("Control+a");
    await svc.handleCommand("key escape");
    expect(page.keyboard.press).toHaveBeenCalledWith("Escape");
  });

  test("click with bad args throws before launching Chromium", async () => {
    const svc = makeService(true);
    await expect(svc.handleCommand("click foo bar")).rejects.toContain(
      "Usage (visual mode)",
    );
    expect(launchMock).not.toHaveBeenCalled();
  });

  test("click out-of-bounds coords throw before launching Chromium", async () => {
    const svc = makeService(true);
    await expect(svc.handleCommand("click -1 100")).rejects.toContain(
      "outside the viewport bounds",
    );
    await expect(svc.handleCommand("click 100 9999")).rejects.toContain(
      "outside the viewport bounds",
    );
    await expect(svc.handleCommand("click 1280 100")).rejects.toContain(
      "outside the viewport bounds",
    );
    expect(launchMock).not.toHaveBeenCalled();
  });

  test("scroll with bad args throws before launching Chromium", async () => {
    const svc = makeService(true);
    await expect(svc.handleCommand("scroll diagonal 100")).rejects.toContain(
      "Usage:",
    );
    expect(launchMock).not.toHaveBeenCalled();
  });

  test("visual open clears stale text-mode pagination", async () => {
    // Force pagination by making webTokenMax tiny so text mode paginates.
    const baseConfig = createMockGlobalConfig().globalConfig();
    const globalConfig = {
      globalConfig: () => ({ ...baseConfig, webTokenMax: 1 }),
    } as any;

    const { page } = makeMockPage({
      ariaSnapshot: "- heading: lots and lots of content here",
    });
    mockLaunch(page);
    const svc = createBrowserService(
      globalConfig,
      makeAgentConfig(true),
      createMockContextManager(),
      createMockOutputService(),
      makeModelService(),
    );

    // Build pagination state via text-mode open
    await svc.handleCommand("mode text");
    const textOpen = await svc.handleCommand("open https://example.com");
    expect(textOpen).toContain("ns-browser more");

    // Switch to visual and re-open — `more` should no longer return chunks.
    await svc.handleCommand("mode visual");
    await svc.handleCommand("open https://example.com");
    const more = await svc.handleCommand("more");
    expect(more).toContain("No paginated content available");
  });

  test("visual click clears stale text-mode pagination", async () => {
    const baseConfig = createMockGlobalConfig().globalConfig();
    const globalConfig = {
      globalConfig: () => ({ ...baseConfig, webTokenMax: 1 }),
    } as any;

    const { page } = makeMockPage({
      ariaSnapshot: "- heading: lots and lots of content here",
    });
    mockLaunch(page);
    const svc = createBrowserService(
      globalConfig,
      makeAgentConfig(true),
      createMockContextManager(),
      createMockOutputService(),
      makeModelService(),
    );

    await svc.handleCommand("mode text");
    await svc.handleCommand("open https://example.com");
    await svc.handleCommand("mode visual");
    await svc.handleCommand("click 100 200");
    const more = await svc.handleCommand("more");
    expect(more).toContain("No paginated content available");
  });

  test("visual scroll clears stale text-mode pagination", async () => {
    const baseConfig = createMockGlobalConfig().globalConfig();
    const globalConfig = {
      globalConfig: () => ({ ...baseConfig, webTokenMax: 1 }),
    } as any;

    const { page } = makeMockPage({
      ariaSnapshot: "- heading: lots and lots of content here",
    });
    mockLaunch(page);
    const svc = createBrowserService(
      globalConfig,
      makeAgentConfig(true),
      createMockContextManager(),
      createMockOutputService(),
      makeModelService(),
    );

    await svc.handleCommand("mode text");
    await svc.handleCommand("open https://example.com");
    await svc.handleCommand("mode visual");
    await svc.handleCommand("scroll down 300");
    const more = await svc.handleCommand("more");
    expect(more).toContain("No paginated content available");
  });

  test("fill is rejected in visual mode", async () => {
    const svc = makeService(true);
    await expect(
      svc.handleCommand('fill "#email" "alice@example.com"'),
    ).rejects.toContain("only available in text mode");
  });

  test("screenshot subcommand returns a confirmation string", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    const result = await svc.handleCommand("screenshot");
    expect(result).toContain("Screenshot captured:");
    expect(page.screenshot).toHaveBeenCalledTimes(2);
  });
});

describe("ns-browser text mode", () => {
  test("open returns the a11y tree, not a screenshot", async () => {
    const { page, ariaSnapshot } = makeMockPage({
      title: "Example Domain",
      ariaSnapshot: "- heading: Example",
    });
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("mode text");
    const result = await svc.handleCommand("open https://example.com");
    expect(ariaSnapshot).toHaveBeenCalled();
    expect(page.screenshot).not.toHaveBeenCalled();
    expect(result).toContain("URL: https://example.com");
    expect(result).toContain("Title: Example Domain");
    expect(result).toContain("- heading: Example");
  });

  test("click <selector> re-dumps the page so `more` doesn't serve stale chunks", async () => {
    const { page, ariaSnapshot } = makeMockPage();
    ariaSnapshot.mockResolvedValueOnce("- heading: Old");
    ariaSnapshot.mockResolvedValueOnce("- heading: New");
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("mode text");
    await svc.handleCommand("open https://example.com");
    const result = await svc.handleCommand("click text=Submit");
    expect(page.click).toHaveBeenCalledWith("text=Submit");
    expect(result).toContain("- heading: New");
    expect(result).not.toContain("- heading: Old");
  });

  test("fill clears pagination so stale `more` returns empty", async () => {
    const baseConfig = createMockGlobalConfig().globalConfig();
    const globalConfig = {
      globalConfig: () => ({ ...baseConfig, webTokenMax: 1 }),
    } as any;

    const { page } = makeMockPage({
      ariaSnapshot: "- heading: lots and lots of content here",
    });
    mockLaunch(page);
    const svc = createBrowserService(
      globalConfig,
      makeAgentConfig(true),
      createMockContextManager(),
      createMockOutputService(),
      makeModelService(),
    );

    await svc.handleCommand("mode text");
    const opened = await svc.handleCommand("open https://example.com");
    expect(opened).toContain("ns-browser more");
    const filled = await svc.handleCommand("fill #email alice@example.com");
    expect(filled).toContain("Filled: #email = alice@example.com");
    const more = await svc.handleCommand("more");
    expect(more).toContain("No paginated content available");
  });

  test("scroll is rejected in text mode", async () => {
    const svc = makeService(true);
    await svc.handleCommand("mode text");
    await expect(svc.handleCommand("scroll down 100")).rejects.toContain(
      "only available in visual mode",
    );
  });
});

describe("ns-browser lifecycle", () => {
  test("close cleans up the page and clears pagination", async () => {
    const { page } = makeMockPage();
    mockLaunch(page);
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    const result = await svc.handleCommand("close");
    expect(page.close).toHaveBeenCalled();
    expect(result).toBe("Page closed.");
    const next = await svc.handleCommand("more");
    expect(next).toContain("No paginated content available");
  });

  test("cleanup() closes the browser", async () => {
    const closeBrowser = vi.fn(() => Promise.resolve());
    const { page } = makeMockPage();
    launchMock.mockResolvedValue({
      newPage: vi.fn(() => Promise.resolve(page)),
      isConnected: () => true,
      close: closeBrowser,
    });
    const svc = makeService(true);
    await svc.handleCommand("open https://example.com");
    await svc.cleanup();
    expect(closeBrowser).toHaveBeenCalled();
  });

  test("cleanup() is a no-op if no browser was launched", async () => {
    const svc = makeService(true);
    await expect(svc.cleanup()).resolves.toBeUndefined();
    expect(launchMock).not.toHaveBeenCalled();
  });
});
