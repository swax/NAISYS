import { describe, expect, test, vi } from "vitest";

import {
  addToSetMap,
  countBy,
  deleteFromSetMap,
  getOrInsert,
  groupBy,
  isDefined,
  keyBy,
  pushToArrayMap,
  replaceSetContents,
  setEquals,
  sumBy,
  unique,
  uniqueBy,
} from "../src/utils/collections.js";

describe("getOrInsert", () => {
  test("returns existing value when key is present", () => {
    const map = new Map<string, number>([["a", 1]]);
    const factory = vi.fn(() => 99);
    expect(getOrInsert(map, "a", factory)).toBe(1);
    expect(factory).not.toHaveBeenCalled();
  });

  test("creates, stores, and returns when key is missing", () => {
    const map = new Map<string, number>();
    expect(getOrInsert(map, "a", () => 42)).toBe(42);
    expect(map.get("a")).toBe(42);
  });

  test("treats explicit undefined as a stored value (does not re-create)", () => {
    const map = new Map<string, number | undefined>([["a", undefined]]);
    const factory = vi.fn(() => 99);
    expect(getOrInsert(map, "a", factory)).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("pushToArrayMap", () => {
  test("creates array on first push", () => {
    const map = new Map<string, number[]>();
    pushToArrayMap(map, "a", 1);
    expect(map.get("a")).toEqual([1]);
  });

  test("appends to existing array preserving order", () => {
    const map = new Map<string, number[]>();
    pushToArrayMap(map, "a", 1);
    pushToArrayMap(map, "a", 2);
    pushToArrayMap(map, "a", 3);
    expect(map.get("a")).toEqual([1, 2, 3]);
  });
});

describe("addToSetMap", () => {
  test("creates set on first add", () => {
    const map = new Map<string, Set<number>>();
    addToSetMap(map, "a", 1);
    expect(map.get("a")).toEqual(new Set([1]));
  });

  test("dedupes within the same key", () => {
    const map = new Map<string, Set<number>>();
    addToSetMap(map, "a", 1);
    addToSetMap(map, "a", 1);
    addToSetMap(map, "a", 2);
    expect(map.get("a")).toEqual(new Set([1, 2]));
  });
});

describe("deleteFromSetMap", () => {
  test("removes value and returns true", () => {
    const map = new Map<string, Set<number>>([["a", new Set([1, 2])]]);
    expect(deleteFromSetMap(map, "a", 1)).toBe(true);
    expect(map.get("a")).toEqual(new Set([2]));
  });

  test("returns false when value is not present", () => {
    const map = new Map<string, Set<number>>([["a", new Set([1])]]);
    expect(deleteFromSetMap(map, "a", 99)).toBe(false);
    expect(map.get("a")).toEqual(new Set([1]));
  });

  test("removes the key when the set becomes empty", () => {
    const map = new Map<string, Set<number>>([["a", new Set([1])]]);
    deleteFromSetMap(map, "a", 1);
    expect(map.has("a")).toBe(false);
  });

  test("returns false when the key is missing", () => {
    const map = new Map<string, Set<number>>();
    expect(deleteFromSetMap(map, "a", 1)).toBe(false);
  });
});

describe("replaceSetContents", () => {
  test("clears and refills, preserving the original reference", () => {
    const target = new Set([1, 2, 3]);
    const ref = target;
    replaceSetContents(target, [4, 5]);
    expect(target).toBe(ref);
    expect([...target]).toEqual([4, 5]);
  });

  test("is safe when source is the target itself", () => {
    const target = new Set([1, 2, 3]);
    replaceSetContents(target, target);
    expect([...target]).toEqual([1, 2, 3]);
  });

  test("accepts arbitrary iterables", () => {
    const target = new Set<number>();
    function* gen() {
      yield 10;
      yield 20;
    }
    replaceSetContents(target, gen());
    expect([...target]).toEqual([10, 20]);
  });
});

describe("setEquals", () => {
  test("true for sets with identical contents", () => {
    expect(setEquals(new Set([1, 2, 3]), new Set([3, 2, 1]))).toBe(true);
  });

  test("false when sizes differ", () => {
    expect(setEquals(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false);
  });

  test("false when same size but different contents", () => {
    expect(setEquals(new Set([1, 2, 3]), new Set([1, 2, 4]))).toBe(false);
  });

  test("true for two empty sets", () => {
    expect(setEquals(new Set(), new Set())).toBe(true);
  });
});

describe("keyBy", () => {
  test("indexes items by selector", () => {
    const items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    const result = keyBy(items, (x) => x.id);
    expect(result.get(1)).toEqual({ id: 1, name: "a" });
    expect(result.get(2)).toEqual({ id: 2, name: "b" });
  });

  test("later items overwrite earlier ones with the same key", () => {
    const items = [
      { id: 1, name: "first" },
      { id: 1, name: "second" },
    ];
    expect(keyBy(items, (x) => x.id).get(1)).toEqual({ id: 1, name: "second" });
  });

  test("works with any iterable", () => {
    function* gen() {
      yield { id: 1 };
      yield { id: 2 };
    }
    expect(keyBy(gen(), (x) => x.id).size).toBe(2);
  });
});

describe("groupBy", () => {
  test("groups items, preserving input order within groups", () => {
    const items = [
      { kind: "a", n: 1 },
      { kind: "b", n: 2 },
      { kind: "a", n: 3 },
      { kind: "a", n: 4 },
    ];
    const result = groupBy(items, (x) => x.kind);
    expect(result.get("a")?.map((x) => x.n)).toEqual([1, 3, 4]);
    expect(result.get("b")?.map((x) => x.n)).toEqual([2]);
  });

  test("returns an empty map for empty input", () => {
    expect(groupBy<number, string>([], () => "x").size).toBe(0);
  });
});

describe("unique", () => {
  test("dedupes preserving first-seen order", () => {
    expect(unique([3, 1, 3, 2, 1, 2])).toEqual([3, 1, 2]);
  });

  test("empty input returns empty array", () => {
    expect(unique([])).toEqual([]);
  });
});

describe("uniqueBy", () => {
  test("keeps the first occurrence per key", () => {
    const items = [
      { id: 1, n: "first" },
      { id: 2, n: "x" },
      { id: 1, n: "later" },
    ];
    expect(uniqueBy(items, (x) => x.id)).toEqual([
      { id: 1, n: "first" },
      { id: 2, n: "x" },
    ]);
  });
});

describe("isDefined", () => {
  test("true for non-nullish values, including falsy ones", () => {
    expect(isDefined(0)).toBe(true);
    expect(isDefined("")).toBe(true);
    expect(isDefined(false)).toBe(true);
    expect(isDefined([])).toBe(true);
  });

  test("false for null and undefined", () => {
    expect(isDefined(null)).toBe(false);
    expect(isDefined(undefined)).toBe(false);
  });

  test("narrows correctly when used as a filter predicate", () => {
    const input: (number | null | undefined)[] = [1, null, 2, undefined, 0];
    const result: number[] = input.filter(isDefined);
    expect(result).toEqual([1, 2, 0]);
  });
});

describe("sumBy", () => {
  test("sums projected values", () => {
    expect(sumBy([{ n: 1 }, { n: 2 }, { n: 3 }], (x) => x.n)).toBe(6);
  });

  test("empty input returns 0", () => {
    expect(sumBy<{ n: number }>([], (x) => x.n)).toBe(0);
  });
});

describe("countBy", () => {
  test("counts items by key", () => {
    const result = countBy(["a", "b", "a", "c", "b", "a"], (x) => x);
    expect(result.get("a")).toBe(3);
    expect(result.get("b")).toBe(2);
    expect(result.get("c")).toBe(1);
  });

  test("empty input returns empty map", () => {
    expect(countBy<string, string>([], (x) => x).size).toBe(0);
  });
});
