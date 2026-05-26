import { describe, expect, test } from "vitest";

import {
  countItems,
  flattenItems,
  type ListInfiniteData,
  type ListPage,
  mergeSocketItemsIntoPage,
  moveToTopOfPage0,
  prependToPage0,
  updateItems,
} from "../hooks/infinite/pageCache";

interface Item {
  id: number;
  at: number;
}

const item = (id: number, at: number = id): Item => ({ id, at });
const key = (i: Item) => i.id;
const recency = (i: Item) => i.at;

const page = (...items: Item[]): ListPage<Item> => ({
  items,
  total: items.length,
});

const data = (...pages: ListPage<Item>[]): ListInfiniteData<Item> => ({
  pageParams: pages.map((_, i) => i + 1),
  pages,
});

describe("flattenItems", () => {
  test("flattens, dedupes by key, and sorts", () => {
    const pages = [page(item(3), item(1)), page(item(2))];
    expect(flattenItems(pages, key, recency, recency, false).map(key)).toEqual([
      1, 2, 3,
    ]);
    expect(flattenItems(pages, key, recency, recency, true).map(key)).toEqual([
      3, 2, 1,
    ]);
  });

  test("keeps the freshest copy when a key spans pages, either order", () => {
    expect(
      flattenItems(
        [page(item(2, 5)), page(item(2, 50))],
        key,
        recency,
        recency,
        false,
      ),
    ).toEqual([{ id: 2, at: 50 }]);
    expect(
      flattenItems(
        [page(item(2, 50)), page(item(2, 5))],
        key,
        recency,
        recency,
        false,
      ),
    ).toEqual([{ id: 2, at: 50 }]);
  });
});

describe("countItems", () => {
  test("counts distinct keys across overlapping pages", () => {
    expect(
      countItems([page(item(1), item(2)), page(item(2), item(3))], key),
    ).toBe(3);
  });
});

describe("mergeSocketItemsIntoPage", () => {
  test("carries cached items newer than every REST item", () => {
    const { items, carried } = mergeSocketItemsIntoPage(
      [item(3), item(2), item(1)],
      [item(5), item(4), item(3), item(2), item(1)],
      key,
      recency,
    );
    expect(carried).toBe(2);
    expect([...items.map(key)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test("does not carry an older cached item the REST page omits", () => {
    // id 1 is older than everything REST returned — it merely drifted to a
    // later page, so re-adding it would double-count against the total.
    const { items, carried } = mergeSocketItemsIntoPage(
      [item(5), item(4), item(3)],
      [item(1)],
      key,
      recency,
    );
    expect(carried).toBe(0);
    expect(items.map(key)).toEqual([5, 4, 3]);
  });

  test("a key in both pages keeps the fresher copy", () => {
    // key and recency differ here, mirroring conversations: a participants
    // key with a lastMessageAt recency.
    const { items, carried } = mergeSocketItemsIntoPage(
      [{ id: 1, at: 10 }],
      [{ id: 1, at: 99 }],
      key,
      recency,
    );
    expect(carried).toBe(0);
    expect(items).toEqual([{ id: 1, at: 99 }]);
  });

  test("counts only cached keys missing from REST as carried", () => {
    const { items, carried } = mergeSocketItemsIntoPage(
      [item(3, 30), item(2, 20), item(1, 10)],
      [item(4, 40), item(3, 300), item(2, 20)],
      key,
      recency,
    );

    expect(carried).toBe(1);
    expect([...items].sort((a, b) => a.id - b.id)).toEqual([
      item(1, 10),
      item(2, 20),
      item(3, 300),
      item(4, 40),
    ]);
  });

  test("does not carry a cached item whose recency ties the REST page max", () => {
    const { items, carried } = mergeSocketItemsIntoPage(
      [item(4, 40), item(3, 30)],
      [item(9, 40)],
      key,
      recency,
    );

    expect(carried).toBe(0);
    expect(items).toEqual([item(4, 40), item(3, 30)]);
  });

  test("an empty cache leaves the REST page intact", () => {
    const rest = [item(2), item(1)];
    expect(mergeSocketItemsIntoPage(rest, [], key, recency)).toEqual({
      items: rest,
      carried: 0,
    });
  });
});

describe("prependToPage0", () => {
  test("seeds a page when the cache is empty", () => {
    expect(prependToPage0(undefined, item(1), key).pages).toEqual([
      { items: [item(1)], total: 1 },
    ]);
  });

  test("prepends to page 0 and bumps total, leaving later pages alone", () => {
    const before = data(page(item(2)), page(item(9)));
    const result = prependToPage0(before, item(3), key);
    expect(result.pages[0]).toEqual({ items: [item(3), item(2)], total: 2 });
    expect(result.pages[1]).toBe(before.pages[1]);
  });

  test("is a no-op when page 0 already holds the key", () => {
    const before = data(page(item(2)));
    expect(prependToPage0(before, item(2), key)).toBe(before);
  });

  test("preserves page params and first-page actions", () => {
    const before: ListInfiniteData<Item> = {
      pageParams: [1, 2],
      pages: [
        {
          ...page(item(2)),
          actions: [{ rel: "send", href: "/send", method: "POST" }],
        },
        page(item(1)),
      ],
    };

    const result = prependToPage0(before, item(3), key);

    expect(result.pageParams).toBe(before.pageParams);
    expect(result.pages[0].actions).toBe(before.pages[0].actions);
  });
});

describe("moveToTopOfPage0", () => {
  test("seeds a page when the cache is empty", () => {
    expect(moveToTopOfPage0(undefined, item(1), key).pages).toEqual([
      { items: [item(1)], total: 1 },
    ]);
  });

  test("moves an existing item to the top without bumping total", () => {
    const before = data(page(item(1), item(2)), page(item(3)));
    const result = moveToTopOfPage0(before, item(3, 99), key);
    expect(result.pages[0].items).toEqual([item(3, 99), item(1), item(2)]);
    expect(result.pages[1].items).toEqual([]);
    expect(result.pages[0].total).toBe(before.pages[0].total);
  });

  test("removes all old copies when moving an item to the top", () => {
    const before = data(page(item(1), item(2)), page(item(2, 20), item(3)));
    const result = moveToTopOfPage0(before, item(2, 99), key);

    expect(result.pages.flatMap((p) => p.items)).toEqual([
      item(2, 99),
      item(1),
      item(3),
    ]);
    expect(countItems(result.pages, key)).toBe(3);
  });

  test("prepends a brand-new item and bumps total", () => {
    const before = data(page(item(1)));
    const result = moveToTopOfPage0(before, item(5), key);
    expect(result.pages[0].items).toEqual([item(5), item(1)]);
    expect(result.pages[0].total).toBe(before.pages[0].total + 1);
  });
});

describe("updateItems", () => {
  test("returns undefined data unchanged", () => {
    expect(updateItems(undefined, (i) => i)).toBeUndefined();
  });

  test("returns the same reference when nothing changes", () => {
    const before = data(page(item(1)), page(item(2)));
    expect(updateItems(before, (i) => i)).toBe(before);
  });

  test("rebuilds only the pages that changed", () => {
    const before = data(page(item(1)), page(item(2)));
    const result = updateItems(before, (i) =>
      i.id === 2 ? { ...i, at: 999 } : i,
    );
    expect(result).not.toBe(before);
    expect(result?.pages[0]).toBe(before.pages[0]);
    expect(result?.pages[1].items[0]).toEqual({ id: 2, at: 999 });
  });
});
