import { type Mock, vi } from "vitest";

import type { BrowserService } from "../../features/browser.js";
import { createBrowserService } from "../../features/browser.js";
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
  webTokenMax?: number;
};

export function buildBrowserService(
  overrides: BuildBrowserServiceOverrides = {},
): BrowserService {
  const browserEnabled = overrides.browserEnabled ?? true;
  const supportsVision = overrides.supportsVision ?? true;

  const baseGlobal = createMockGlobalConfig();
  const globalConfig =
    overrides.webTokenMax !== undefined
      ? ({
          globalConfig: () => ({
            ...baseGlobal.globalConfig(),
            webTokenMax: overrides.webTokenMax,
          }),
        } as any)
      : baseGlobal;

  const agentConfig = {
    agentConfig: () => ({ browserEnabled, shellModel: "shell-model" }) as any,
  } as any;
  const modelService = {
    getLlmModel: vi.fn(() => ({ supportsVision })),
  } as any;

  return createBrowserService(
    globalConfig,
    agentConfig,
    createMockContextManager(),
    createMockOutputService(),
    modelService,
  );
}

export async function openPaginatedTextPage(
  service: BrowserService,
  url = "https://example.com",
) {
  await service.handleCommand("mode text");
  return service.handleCommand(`open ${url}`);
}
