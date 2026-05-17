import { type Mock, vi } from "vitest";

import {
  createPagedOutputBuffer,
  type PagedOutputBuffer,
} from "../../command/pagedOutputBuffer.js";
import type { BrowserService } from "../../features/web/browser.js";
import { createBrowserService } from "../../features/web/browser.js";
import {
  createMockContextManager,
  createMockGlobalConfig,
  createMockOutputService,
} from "../mocks.js";

export interface MockPageOverrides {
  url?: string;
  title?: string;
  ariaSnapshot?: string | (() => Promise<string>);
}

export function makeMockPage(overrides: MockPageOverrides = {}) {
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
  const on = vi.fn();
  const waitForLoadState = vi.fn(() => Promise.resolve());
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
    on,
    waitForLoadState,
    mouse,
    keyboard,
  };
  return { page, ariaSnapshot };
}

export function mockLaunch(
  launchMock: Mock,
  page: ReturnType<typeof makeMockPage>["page"],
  options: { closeBrowser?: Mock } = {},
) {
  launchMock.mockResolvedValue({
    newPage: vi.fn(() => Promise.resolve(page)),
    isConnected: () => true,
    close: options.closeBrowser ?? vi.fn(() => Promise.resolve()),
  });
}

export type BuildBrowserServiceOverrides = {
  browserEnabled?: boolean;
  supportsVision?: boolean;
  outputTokenMax?: number;
  contextManager?: ReturnType<typeof createMockContextManager>;
};

function makeMocks(overrides: BuildBrowserServiceOverrides) {
  const browserEnabled = overrides.browserEnabled ?? true;
  const supportsVision = overrides.supportsVision ?? true;

  const baseGlobal = createMockGlobalConfig();
  const globalConfig =
    overrides.outputTokenMax !== undefined
      ? ({
          globalConfig: () => ({
            ...baseGlobal.globalConfig(),
            shellCommand: {
              ...baseGlobal.globalConfig().shellCommand,
              outputTokenMax: overrides.outputTokenMax,
            },
          }),
        } as any)
      : baseGlobal;

  const agentConfig = {
    agentConfig: () => ({ browserEnabled, shellModel: "shell-model" }) as any,
  } as any;
  const modelService = {
    getLlmModel: vi.fn(() => ({ supportsVision })),
  } as any;

  return { globalConfig, agentConfig, modelService };
}

export function buildBrowserService(
  overrides: BuildBrowserServiceOverrides = {},
): BrowserService {
  const { globalConfig, agentConfig, modelService } = makeMocks(overrides);
  return createBrowserService(
    globalConfig,
    agentConfig,
    overrides.contextManager ?? createMockContextManager(),
    createMockOutputService(),
    modelService,
    createPagedOutputBuffer(globalConfig),
  );
}

/** Variant that also returns the buffer for tests asserting on paging state. */
export function buildBrowserAndBuffer(
  overrides: BuildBrowserServiceOverrides = {},
): { service: BrowserService; buf: PagedOutputBuffer } {
  const { globalConfig, agentConfig, modelService } = makeMocks(overrides);
  const buf = createPagedOutputBuffer(globalConfig);
  const service = createBrowserService(
    globalConfig,
    agentConfig,
    overrides.contextManager ?? createMockContextManager(),
    createMockOutputService(),
    modelService,
    buf,
  );
  return { service, buf };
}

export async function openPaginatedTextPage(
  service: BrowserService,
  url = "https://example.com",
) {
  await service.handleCommand("mode text");
  return service.handleCommand(`open ${url}`);
}
