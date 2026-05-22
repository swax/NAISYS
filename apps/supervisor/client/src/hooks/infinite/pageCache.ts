import { type HateoasAction, sortBy, sortByDesc } from "@naisys/common";
import type { InfiniteData } from "@tanstack/react-query";

/** A dedup key — an item id or a participants string. */
type ItemKey = string | number;

/**
 * One normalized page of a live infinite list. Each hook's `fetchPage` adapts
 * its REST response into this shape, so the flatten, pagination, and socket
 * merges downstream are free of per-endpoint quirks.
 */
export interface ListPage<TItem> {
  items: TItem[];
  total: number;
  actions?: HateoasAction[];
}

export type ListInfiniteData<TItem> = InfiniteData<ListPage<TItem>, number>;

/**
 * Flatten every page into one list, deduped by key — when a key spans pages
 * (offset pages drift as the list re-sorts) the freshest copy wins — then
 * sorted for display.
 */
export function flattenItems<TItem>(
  pages: ListPage<TItem>[],
  getKey: (item: TItem) => ItemKey,
  getRecency: (item: TItem) => number,
  getSortValue: (item: TItem) => number,
  descending: boolean,
): TItem[] {
  const byKey = new Map<ItemKey, TItem>();
  for (const page of pages) {
    for (const item of page.items) {
      const existing = byKey.get(getKey(item));
      if (!existing || getRecency(item) >= getRecency(existing)) {
        byKey.set(getKey(item), item);
      }
    }
  }
  const items = [...byKey.values()];
  return descending
    ? sortByDesc(items, getSortValue)
    : sortBy(items, getSortValue);
}

/**
 * Count the distinct items loaded across all pages. Offset pages overlap as
 * the list re-sorts, so a raw page-length sum would overcount against the
 * server total and `loadMore` would stop short.
 */
export function countItems<TItem>(
  pages: ListPage<TItem>[],
  getKey: (item: TItem) => ItemKey,
): number {
  const keys = new Set<ItemKey>();
  for (const page of pages) {
    for (const item of page.items) keys.add(getKey(item));
  }
  return keys.size;
}

/**
 * Reconcile a freshly-fetched page 1 against the page 0 already in cache.
 * Socket pushes land on page 0, so a push that beat this fetch must survive:
 *  - a key in both pages keeps whichever copy is fresher, so a socket bump is
 *    not reverted to the REST snapshot;
 *  - a cached key the REST page omits is carried only when it is fresher than
 *    everything REST returned — i.e. genuinely socket-new; an older omitted
 *    key merely drifted to a later page, and re-adding it here would
 *    double-count it against the server total.
 * `carried` is how many socket-new keys were added, for bumping `total`.
 */
export function mergeSocketItemsIntoPage<TItem>(
  restItems: TItem[],
  cachedItems: TItem[],
  getKey: (item: TItem) => ItemKey,
  getRecency: (item: TItem) => number,
): { items: TItem[]; carried: number } {
  const maxRestRecency = restItems.reduce(
    (max, item) => Math.max(max, getRecency(item)),
    0,
  );
  const byKey = new Map<ItemKey, TItem>();
  for (const item of restItems) byKey.set(getKey(item), item);
  let carried = 0;
  for (const item of cachedItems) {
    const current = byKey.get(getKey(item));
    if (current) {
      if (getRecency(item) > getRecency(current)) {
        byKey.set(getKey(item), item);
      }
    } else if (getRecency(item) > maxRestRecency) {
      byKey.set(getKey(item), item);
      carried++;
    }
  }
  return { items: [...byKey.values()], carried };
}

/** A fresh single-item page 1, for seeding a cache that holds no pages yet. */
function seedPage<TItem>(item: TItem): ListInfiniteData<TItem> {
  return { pageParams: [1], pages: [{ items: [item], total: 1 }] };
}

/**
 * Add a socket-pushed item to the top of page 0. Seeds a one-item page when
 * the cache is empty, so a push that beats the first REST fetch isn't lost.
 * Returns `data` unchanged when page 0 already holds the item's key (a
 * duplicate delivery), so React Query skips the re-render.
 */
export function prependToPage0<TItem>(
  data: ListInfiniteData<TItem> | undefined,
  item: TItem,
  getKey: (item: TItem) => ItemKey,
): ListInfiniteData<TItem> {
  if (!data || data.pages.length === 0) return seedPage(item);
  const [first, ...rest] = data.pages;
  if (first.items.some((i) => getKey(i) === getKey(item))) return data;
  return {
    ...data,
    pages: [
      { ...first, items: [item, ...first.items], total: first.total + 1 },
      ...rest,
    ],
  };
}

/**
 * Move a socket-pushed item to the top of page 0, dropping any prior copy of
 * its key from every page first — a re-pushed item (a conversation that got a
 * new message) carries fresh content. Seeds a one-item page when the cache is
 * empty. `total` rises only when the key was not already present.
 */
export function moveToTopOfPage0<TItem>(
  data: ListInfiniteData<TItem> | undefined,
  item: TItem,
  getKey: (item: TItem) => ItemKey,
): ListInfiniteData<TItem> {
  if (!data || data.pages.length === 0) return seedPage(item);
  let existed = false;
  const stripped = data.pages.map((page) => {
    const kept = page.items.filter((i) => {
      if (getKey(i) === getKey(item)) {
        existed = true;
        return false;
      }
      return true;
    });
    return kept.length === page.items.length ? page : { ...page, items: kept };
  });
  const [first, ...rest] = stripped;
  return {
    ...data,
    pages: [
      {
        ...first,
        items: [item, ...first.items],
        total: existed ? first.total : first.total + 1,
      },
      ...rest,
    ],
  };
}

/**
 * Apply `update` to every item across every page. `update` must return the
 * same reference for an unchanged item; pages and the container are likewise
 * rebuilt only where something changed, so an all-no-op call returns `data`
 * unchanged and React Query skips the re-render.
 */
export function updateItems<TItem>(
  data: ListInfiniteData<TItem> | undefined,
  update: (item: TItem) => TItem,
): ListInfiniteData<TItem> | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const items = page.items.map((item) => {
      const next = update(item);
      if (next !== item) pageChanged = true;
      return next;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, items };
  });
  return changed ? { ...data, pages } : data;
}
