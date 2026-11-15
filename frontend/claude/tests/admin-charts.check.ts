import { describe, it, expect } from "vitest";
import {
  barFractions,
  computePieSlices,
  pieSliceLabelColor,
  seriesGridTicks,
  seriesLabelIndexes,
} from "../src/components/admin/charts/geometry";

describe("pie slices", () => {
  it("returns no slices for empty or all-zero input", () => {
    expect(computePieSlices([])).toEqual([]);
    expect(
      computePieSlices([
        { label: "A", value: 0 },
        { label: "B", value: 0 },
      ]),
    ).toEqual([]);
    expect(computePieSlices([{ label: "A", value: -5 }])).toEqual([]);
  });
  it("orders largest first starting at 12 o'clock and sums to 360 degrees", () => {
    const slices = computePieSlices([
      { label: "Small", value: 1 },
      { label: "Large", value: 3 },
      { label: "Medium", value: 2 },
    ]);
    expect(slices.map((slice) => slice.label)).toEqual([
      "Large",
      "Medium",
      "Small",
    ]);
    expect(slices[0]?.startAngle).toBe(0);
    expect(slices[0]?.endAngle).toBe(180);
    expect(slices[2]?.endAngle).toBe(360);
    const span = slices.reduce(
      (sum, slice) => sum + (slice.endAngle - slice.startAngle),
      0,
    );
    expect(span).toBeCloseTo(360, 9);
    expect(
      slices.reduce((sum, slice) => sum + slice.share, 0),
    ).toBeCloseTo(1, 9);
  });
  it("keeps the caller's index on each slice so colours follow the segment", () => {
    const slices = computePieSlices([
      { label: "A", value: 1 },
      { label: "B", value: 4 },
    ]);
    expect(slices[0]?.sourceIndex).toBe(1);
    expect(slices[1]?.sourceIndex).toBe(0);
  });
  it("excludes zero-value segments from slices", () => {
    const slices = computePieSlices([
      { label: "A", value: 2 },
      { label: "B", value: 0 },
      { label: "C", value: 2 },
    ]);
    expect(slices).toHaveLength(2);
    expect(slices.map((slice) => slice.label)).toEqual(["A", "C"]);
  });
  it("marks a single whole-pie slice as a full circle with no arc path", () => {
    const slices = computePieSlices([{ label: "Only", value: 7 }]);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.isFullCircle).toBe(true);
    expect(slices[0]?.path).toBe("");
    expect(slices[0]?.startAngle).toBe(0);
    expect(slices[0]?.endAngle).toBe(360);
    expect(slices[0]?.share).toBe(1);
  });
  it("draws arc paths from the centre for partial slices", () => {
    const slices = computePieSlices([
      { label: "A", value: 1 },
      { label: "B", value: 1 },
    ]);
    expect(slices[0]?.isFullCircle).toBe(false);
    expect(slices[0]?.path).toMatch(/^M100,100 L[\d.]+,[\d.]+ A96,96 0 0,1 [\d.]+,[\d.]+ Z$/);
  });
  it("places direct labels inside the pie", () => {
    const slices = computePieSlices([
      { label: "A", value: 3 },
      { label: "B", value: 1 },
    ]);
    for (const slice of slices) {
      const dx = slice.labelX - 100;
      const dy = slice.labelY - 100;
      expect(Math.hypot(dx, dy)).toBeLessThan(96);
    }
  });
  it("handles eight statuses without dropping any nonzero slice", () => {
    const slices = computePieSlices([
      { label: "Pending", value: 5 },
      { label: "Confirmed", value: 4 },
      { label: "Packed", value: 3 },
      { label: "Shipped", value: 2 },
      { label: "Out for Delivery", value: 1 },
      { label: "Delivered", value: 6 },
      { label: "Cancelled", value: 0 },
      { label: "Returned", value: 1 },
    ]);
    expect(slices).toHaveLength(7);
    expect(slices[0]?.label).toBe("Delivered");
  });
});

describe("pie slice label colour", () => {
  it("uses white ink on the brand maroon and dark ink on light tones", () => {
    expect(pieSliceLabelColor("#6B0202")).toBe("#FFFFFF");
    expect(pieSliceLabelColor("#460101")).toBe("#FFFFFF");
    expect(pieSliceLabelColor("#C08A2C")).toBe("#171717");
    expect(pieSliceLabelColor("#9A9494")).toBe("#171717");
    expect(pieSliceLabelColor("#FFFFFF")).toBe("#171717");
    expect(pieSliceLabelColor("#000000")).toBe("#FFFFFF");
  });
  it("handles shorthand hex and falls back to dark ink", () => {
    expect(pieSliceLabelColor("#fff")).toBe("#171717");
    expect(pieSliceLabelColor("not-a-colour")).toBe("#171717");
    expect(pieSliceLabelColor("")).toBe("#171717");
  });
});

describe("series grid ticks", () => {
  it("returns quarter fractions of the maximum", () => {
    expect(seriesGridTicks(1000)).toEqual([0, 250, 500, 750, 1000]);
    expect(seriesGridTicks(3)).toEqual([0, 0.75, 1.5, 2.25, 3]);
  });
  it("returns a single zero line for a non-positive maximum", () => {
    expect(seriesGridTicks(0)).toEqual([0]);
    expect(seriesGridTicks(-10)).toEqual([0]);
  });
});

describe("series x-axis label indexes", () => {
  it("labels every point in a short series", () => {
    expect(seriesLabelIndexes(1)).toEqual([0]);
    expect(seriesLabelIndexes(6)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("spaces labels evenly and always includes the first and last point", () => {
    const indexes = seriesLabelIndexes(30);
    expect(indexes).toHaveLength(6);
    expect(indexes[0]).toBe(0);
    expect(indexes[indexes.length - 1]).toBe(29);
    for (let i = 1; i < indexes.length; i += 1) {
      expect(indexes[i]).toBeGreaterThan(indexes[i - 1] ?? 0);
    }
    expect(seriesLabelIndexes(31)).toEqual([0, 6, 12, 18, 24, 30]);
  });
  it("returns no indexes for an empty series", () => {
    expect(seriesLabelIndexes(0)).toEqual([]);
  });
});

describe("bar fractions", () => {
  it("scales values against the largest", () => {
    expect(barFractions([10, 5, 0])).toEqual([1, 0.5, 0]);
    expect(barFractions([7])).toEqual([1]);
  });
  it("returns zeroes for empty or all-zero input", () => {
    expect(barFractions([])).toEqual([]);
    expect(barFractions([0, 0])).toEqual([0, 0]);
  });
  it("clamps negative values to zero", () => {
    expect(barFractions([4, -2])).toEqual([1, 0]);
  });
});
