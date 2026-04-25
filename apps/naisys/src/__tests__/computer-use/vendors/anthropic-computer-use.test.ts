import { describe, expect, test } from "vitest";

import { extractDesktopActions } from "../../../computer-use/vendors/anthropic-computer-use.js";

describe("anthropic computer use extraction", () => {
  test("passes known action shapes through unchanged", () => {
    const actions = extractDesktopActions([
      {
        type: "tool_use",
        id: "call-1",
        name: "computer",
        input: { action: "left_click", coordinate: [10, 20] },
      },
    ]);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: "call-1",
      name: "computer",
      input: { actions: [{ action: "left_click", coordinate: [10, 20] }] },
    });
    expect(actions[0].validationError).toBeUndefined();
  });

  test("flags unknown action discriminators with a validationError", () => {
    const actions = extractDesktopActions([
      {
        type: "tool_use",
        id: "call-bogus",
        name: "computer",
        input: { action: "quadruple_click", coordinate: [5, 5] },
      },
    ]);

    expect(actions).toHaveLength(1);
    expect(actions[0].validationError).toMatch(/quadruple_click/);
    // Raw input is preserved on the assistant message so replay shows the
    // model exactly what it emitted.
    expect(actions[0].input.actions).toEqual([
      { action: "quadruple_click", coordinate: [5, 5] },
    ]);
  });

  test("flags missing action discriminator", () => {
    const actions = extractDesktopActions([
      {
        type: "tool_use",
        id: "call-missing",
        name: "computer",
        input: { coordinate: [1, 2] },
      },
    ]);

    expect(actions[0].validationError).toMatch(/no action field/);
  });
});
