import { describe, expect, test } from "vitest";

import {
  appendInputHistory,
  navigateInputHistory,
} from "../hooks/useInputHistory";

describe("input history helpers", () => {
  test("trims entries, ignores blanks, suppresses adjacent duplicates, and caps length", () => {
    const empty: string[] = [];
    expect(appendInputHistory(empty, "   ")).toBe(empty);

    const first = appendInputHistory(empty, "  first command  ");
    expect(first).toEqual(["first command"]);

    expect(appendInputHistory(first, "first command")).toBe(first);

    const capped = appendInputHistory(
      appendInputHistory(first, "second command"),
      "third command",
      2,
    );
    expect(capped).toEqual(["second command", "third command"]);
  });

  test("walks backward through history and restores the draft after the newest entry", () => {
    const history = ["oldest", "newest"];
    let value = "draft text";
    let state = { index: -1, draft: "" };

    const firstUp = navigateInputHistory({
      key: "ArrowUp",
      history,
      value,
      selectionStart: 0,
      state,
    });
    expect(firstUp).toEqual({
      preventDefault: true,
      state: { index: 1, draft: "draft text" },
      value: "newest",
    });

    value = firstUp.value ?? value;
    state = firstUp.state;
    const secondUp = navigateInputHistory({
      key: "ArrowUp",
      history,
      value,
      selectionStart: 0,
      state,
    });
    expect(secondUp).toEqual({
      preventDefault: true,
      state: { index: 0, draft: "draft text" },
      value: "oldest",
    });

    const blockedUp = navigateInputHistory({
      key: "ArrowUp",
      history,
      value: secondUp.value ?? value,
      selectionStart: 0,
      state: secondUp.state,
    });
    expect(blockedUp).toEqual({
      preventDefault: true,
      state: { index: 0, draft: "draft text" },
    });

    const firstDown = navigateInputHistory({
      key: "ArrowDown",
      history,
      value: secondUp.value ?? value,
      selectionStart: "oldest".length,
      state: secondUp.state,
    });
    expect(firstDown).toEqual({
      preventDefault: true,
      state: { index: 1, draft: "draft text" },
      value: "newest",
    });

    const secondDown = navigateInputHistory({
      key: "ArrowDown",
      history,
      value: firstDown.value ?? value,
      selectionStart: "newest".length,
      state: firstDown.state,
    });
    expect(secondDown).toEqual({
      preventDefault: true,
      state: { index: -1, draft: "draft text" },
      value: "draft text",
    });
  });

  test("does not hijack multiline cursor movement away from the edge line", () => {
    const history = ["previous"];
    const value = "first line\nsecond line";

    expect(
      navigateInputHistory({
        key: "ArrowUp",
        history,
        value,
        selectionStart: value.length,
        state: { index: -1, draft: "" },
      }),
    ).toEqual({
      preventDefault: false,
      state: { index: -1, draft: "" },
    });

    expect(
      navigateInputHistory({
        key: "ArrowDown",
        history,
        value,
        selectionStart: 0,
        state: { index: 0, draft: "draft" },
      }),
    ).toEqual({
      preventDefault: false,
      state: { index: 0, draft: "draft" },
    });
  });

  test("ignores ArrowDown before history navigation starts", () => {
    expect(
      navigateInputHistory({
        key: "ArrowDown",
        history: ["previous"],
        value: "draft",
        selectionStart: "draft".length,
        state: { index: -1, draft: "" },
      }),
    ).toEqual({
      preventDefault: false,
      state: { index: -1, draft: "" },
    });
  });
});
