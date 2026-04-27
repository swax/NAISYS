import { describe, expect, test } from "vitest";

import {
  mapActionBetweenSpaces,
  mapCoordinateBetweenSpaces,
} from "../../computer-use/computerService.js";

describe("computerService coordinate mapping", () => {
  test("maps coordinates between arbitrary visible spaces", () => {
    expect(
      mapCoordinateBetweenSpaces([828, 764], 1380, 776, 3840, 2160),
    ).toEqual([2304, 2127]);
  });

  test("maps action coordinates between spaces", () => {
    expect(
      mapActionBetweenSpaces(
        {
          action: "left_click_drag",
          coordinate: [50, 25],
          start_coordinate: [10, 5],
        },
        100,
        50,
        500,
        250,
      ),
    ).toEqual({
      action: "left_click_drag",
      coordinate: [250, 125],
      start_coordinate: [50, 25],
    });
  });
});
