/**
 * Pagination state machine for web content (text-mode lynx, browser a11y dumps).
 *
 * Each consumer formats its own headers/footers around the page content so
 * lynx can keep its `[link]` substitution and browser can show selectors,
 * but the splitting logic and "more" navigation are shared.
 */

import * as utilities from "../utils/utilities.js";

export interface PaginatedView {
  content: string;
  url: string;
  pageNum: number;
  totalPages: number;
}

/**
 * Split `content` into pages capped at `tokensPerPage` tokens each.
 * Returns at least one page even when content is small.
 */
export function breakContentIntoPages(
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

export function createPaginationState() {
  let state: { url: string; pages: string[]; currentPage: number } | null =
    null;

  function setContent(
    url: string,
    content: string,
    tokensPerPage: number,
  ): PaginatedView {
    const pages = breakContentIntoPages(content, tokensPerPage);
    state = { url, pages, currentPage: 1 };
    return {
      content: pages[0],
      url,
      pageNum: 1,
      totalPages: pages.length,
    };
  }

  function next(): PaginatedView | null {
    if (!state) return null;
    if (state.currentPage >= state.pages.length) return null;
    state.currentPage++;
    return {
      content: state.pages[state.currentPage - 1],
      url: state.url,
      pageNum: state.currentPage,
      totalPages: state.pages.length,
    };
  }

  function hasContent(): boolean {
    return state !== null;
  }

  function isAtLastPage(): boolean {
    return state !== null && state.currentPage >= state.pages.length;
  }

  function getLastUrl(): string | null {
    return state?.url ?? null;
  }

  function getTotalPages(): number {
    return state?.pages.length ?? 0;
  }

  function clear(): void {
    state = null;
  }

  return {
    setContent,
    next,
    hasContent,
    isAtLastPage,
    getLastUrl,
    getTotalPages,
    clear,
  };
}

export type PaginationState = ReturnType<typeof createPaginationState>;
