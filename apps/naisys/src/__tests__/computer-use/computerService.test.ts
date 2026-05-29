import { describe, expect, test } from "vitest";

import {
  buildMarkerSvg,
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

describe("buildMarkerSvg", () => {
  test("sizes the overlay to the screenshot and centers the marker", () => {
    const svg = buildMarkerSvg(344, 322, 1380, 776);
    // Overlay spans the whole screenshot (composites 1:1).
    expect(svg).toContain('width="1380"');
    expect(svg).toContain('height="776"');
    // Crosshair, ring, and center dot anchored on the point.
    expect(svg).toContain('cx="344" cy="322"');
    expect(svg).toContain(
      '<circle cx="344" cy="322" r="2.5" fill="red" stroke="white" stroke-width="1"/>',
    );
    // Red marker drawn over a white halo for contrast.
    expect(svg).toContain('stroke="white"');
    expect(svg).toContain('stroke="red"');
  });
});
