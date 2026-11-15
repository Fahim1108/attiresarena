import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  COUNT_UP_DURATION_MS,
  countUpValueAt,
  easeOutCubic,
} from "../src/components/admin/charts/animation";
import {
  DONUT_INNER_RADIUS,
  DONUT_OUTER_RADIUS,
  areaPathFromLine,
  computeDonutSlices,
  pieSliceLabelColor,
  smoothLinePath,
} from "../src/components/admin/charts/geometry";
import { segmentedActiveIndex } from "../src/components/admin/period-toggle";
import { DONUT_PALETTE } from "../src/components/admin/charts/DonutChart";
import { ChartEmptyState } from "../src/components/admin/charts/ChartEmptyState";
import {
  CountUpValue,
  formatCountUpValue,
} from "../src/components/admin/charts/CountUpValue";
import { PeriodToggle } from "../src/components/admin/PeriodToggle";
import {
  formatCount,
  formatMoney,
  formatMoneyShort,
} from "../src/lib/admin/format";

describe("donut slices", () => {
  it("returns no slices for empty or all-zero input", () => {
    expect(computeDonutSlices([])).toEqual([]);
    expect(
      computeDonutSlices([
        { label: "A", value: 0 },
        { label: "B", value: -2 },
      ]),
    ).toEqual([]);
  });
  it("orders largest first starting at 12 o'clock and sums to 360 degrees", () => {
    const slices = computeDonutSlices([
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
    expect(slices[2]?.endAngle).toBe(360);
    expect(
      slices.reduce((sum, slice) => sum + (slice.endAngle - slice.startAngle), 0),
    ).toBeCloseTo(360, 9);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 9);
  });
  it("draws ring paths with outer and inner arcs", () => {
    const slices = computeDonutSlices([
      { label: "A", value: 1 },
      { label: "B", value: 1 },
    ]);
    expect(slices).toHaveLength(2);
    expect(slices[0]?.isFullCircle).toBe(false);
    expect(slices[0]?.path).toContain(`A${DONUT_OUTER_RADIUS},${DONUT_OUTER_RADIUS}`);
    expect(slices[0]?.path).toContain(`A${DONUT_INNER_RADIUS},${DONUT_INNER_RADIUS}`);
    expect(slices[0]?.path.endsWith("Z")).toBe(true);
  });
  it("draws a full ring path for a single whole-donut slice", () => {
    const slices = computeDonutSlices([{ label: "Only", value: 7 }]);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.isFullCircle).toBe(true);
    expect(slices[0]?.path).not.toBe("");
    expect(slices[0]?.path).toContain(`A${DONUT_OUTER_RADIUS},${DONUT_OUTER_RADIUS}`);
    expect(slices[0]?.path).toContain(`A${DONUT_INNER_RADIUS},${DONUT_INNER_RADIUS}`);
  });
  it("places direct labels on the ring mid-radius", () => {
    const slices = computeDonutSlices([
      { label: "A", value: 3 },
      { label: "B", value: 1 },
    ]);
    for (const slice of slices) {
      const distance = Math.hypot(slice.labelX - 100, slice.labelY - 100);
      expect(distance).toBeGreaterThan(DONUT_INNER_RADIUS);
      expect(distance).toBeLessThan(DONUT_OUTER_RADIUS);
    }
  });
  it("handles eight statuses without dropping any nonzero slice", () => {
    const slices = computeDonutSlices([
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
    expect(slices[0]?.sourceIndex).toBe(5);
  });
});

describe("colourful status palette", () => {
  it("has exactly eight distinct colours, one per order status", () => {
    expect(DONUT_PALETTE).toHaveLength(8);
    expect(new Set(DONUT_PALETTE).size).toBe(8);
  });
  it("keeps the brand maroon in the palette", () => {
    expect(DONUT_PALETTE).toContain("#6B0202");
  });
  it("gives every slice colour a readable direct-label ink", () => {
    // Each pairing was verified against WCAG contrast (all >= 4.5:1);
    // the helper must keep picking the verified ink for each tone.
    const expected: Record<string, "#FFFFFF" | "#171717"> = {
      "#C08A2C": "#171717",
      "#1F7A6D": "#FFFFFF",
      "#7B4B94": "#FFFFFF",
      "#2E7D32": "#FFFFFF",
      "#B04A12": "#FFFFFF",
      "#6B0202": "#FFFFFF",
      "#B42318": "#FFFFFF",
      "#9A9494": "#171717",
    };
    for (const color of DONUT_PALETTE) {
      expect(pieSliceLabelColor(color)).toBe(expected[color]);
    }
  });
});

describe("smooth series path", () => {
  it("returns an empty path for no dots", () => {
    expect(smoothLinePath([])).toBe("");
  });
  it("draws straight segments for one or two dots", () => {
    expect(smoothLinePath([{ x: 10, y: 20 }])).toBe("M10,20");
    expect(
      smoothLinePath([
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ]),
    ).toBe("M10,20 L30,40");
  });
  it("smooths three or more dots with cubic segments", () => {
    const path = smoothLinePath([
      { x: 0, y: 100 },
      { x: 50, y: 20 },
      { x: 100, y: 80 },
      { x: 150, y: 40 },
    ]);
    expect(path.startsWith("M0,100")).toBe(true);
    expect(path).toContain("C");
    expect(path.endsWith("150,40")).toBe(true);
  });
  it("keeps a flat series flat (smoothing never invents values)", () => {
    const path = smoothLinePath([
      { x: 0, y: 50 },
      { x: 10, y: 50 },
      { x: 20, y: 50 },
      { x: 30, y: 50 },
    ]);
    const numbers = path.match(/-?\d+(\.\d+)?/g) ?? [];
    const yValues = numbers.filter((_, index) => index % 2 === 1);
    expect(yValues.every((value) => value === "50")).toBe(true);
  });
  it("rounds coordinates to one decimal place", () => {
    const path = smoothLinePath([
      { x: 0.04, y: 10.06 },
      { x: 10.04, y: 20.06 },
      { x: 20.04, y: 30.06 },
    ]);
    expect(path).not.toMatch(/\d+\.\d\d/);
  });
});

describe("area path from line", () => {
  it("closes the line down to the baseline", () => {
    expect(areaPathFromLine("M0,10 L10,20", 0, 10, 100)).toBe(
      "M0,10 L10,20 L10,100 L0,100 Z",
    );
  });
  it("returns empty for an empty line", () => {
    expect(areaPathFromLine("", 0, 10, 100)).toBe("");
  });
});

describe("count-up animation", () => {
  it("eases out from 0 to 1 without overshoot", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 9);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
  it("starts at zero and lands exactly on the target", () => {
    expect(countUpValueAt(0, COUNT_UP_DURATION_MS, 1250, false)).toBe(0);
    expect(
      countUpValueAt(COUNT_UP_DURATION_MS, COUNT_UP_DURATION_MS, 1250, false),
    ).toBe(1250);
    expect(
      countUpValueAt(COUNT_UP_DURATION_MS + 500, COUNT_UP_DURATION_MS, 1250, false),
    ).toBe(1250);
  });
  it("rises monotonically and never overshoots", () => {
    let previous = 0;
    for (let elapsed = 0; elapsed <= COUNT_UP_DURATION_MS; elapsed += 50) {
      const value = countUpValueAt(elapsed, COUNT_UP_DURATION_MS, 999, false);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(999);
      previous = value;
    }
  });
  it("shows the final value immediately with reduced motion", () => {
    expect(countUpValueAt(0, COUNT_UP_DURATION_MS, 999, true)).toBe(999);
    expect(countUpValueAt(100, COUNT_UP_DURATION_MS, 999, true)).toBe(999);
  });
  it("shows non-positive targets and zero durations as-is", () => {
    expect(countUpValueAt(100, COUNT_UP_DURATION_MS, 0, false)).toBe(0);
    expect(countUpValueAt(100, 0, 999, false)).toBe(999);
  });
});

describe("segmented control state", () => {
  it("finds the active value", () => {
    expect(segmentedActiveIndex(["auto", "day", "month"], "day")).toBe(1);
    expect(segmentedActiveIndex(["auto", "day", "month"], "month")).toBe(2);
  });
  it("falls back to the default when the value is missing or unknown", () => {
    expect(segmentedActiveIndex(["auto", "day", "month"], undefined)).toBe(0);
    expect(segmentedActiveIndex(["auto", "day", "month"], "year")).toBe(0);
    expect(segmentedActiveIndex(["auto", "day", "month"], undefined, 1)).toBe(1);
    expect(segmentedActiveIndex(["auto", "day", "month"], "year", 2)).toBe(2);
  });
  it("clamps the default and reports no option for an empty list", () => {
    expect(segmentedActiveIndex(["auto", "day"], undefined, 9)).toBe(1);
    expect(segmentedActiveIndex([], undefined)).toBe(-1);
  });
});

describe("chart empty state", () => {
  it("renders the title and guidance", () => {
    const html = renderToStaticMarkup(
      createElement(ChartEmptyState, {
        title: "No revenue in this period.",
        guidance: "Revenue appears here once orders are placed.",
      }),
    );
    expect(html).toContain("No revenue in this period.");
    expect(html).toContain("Revenue appears here once orders are placed.");
  });
  it("renders without guidance when none is given", () => {
    const html = renderToStaticMarkup(
      createElement(ChartEmptyState, { title: "No data in this period." }),
    );
    expect(html).toContain("No data in this period.");
  });
});

describe("count-up value", () => {
  it("formats exactly like the shared admin formatters", () => {
    for (const value of [0, 1, 42, 1250, 123456, 1000000]) {
      expect(formatCountUpValue(value, "count")).toBe(formatCount(value));
      expect(formatCountUpValue(value, "money")).toBe(formatMoney(value));
      expect(formatCountUpValue(value, "money-short")).toBe(
        formatMoneyShort(value),
      );
    }
  });
  it("server-renders the final value (no zero flash in the HTML)", () => {
    const html = renderToStaticMarkup(
      createElement(CountUpValue, { value: 125000, format: "money" }),
    );
    expect(html).toContain("৳1,250.00");
    expect(html).not.toContain("৳0.00");
  });
});

describe("period toggle", () => {
  const options = [
    { value: "auto", label: "Automatic", href: "/admin?from=2026-11-01" },
    { value: "day", label: "Daily", href: "/admin?from=2026-11-01&granularity=day" },
    { value: "month", label: "Monthly", href: "/admin?from=2026-11-01&granularity=month" },
  ];
  it("marks the active option and keeps every href", () => {
    const html = renderToStaticMarkup(
      createElement(PeriodToggle, {
        options,
        activeValue: "day",
        defaultValue: "auto",
        ariaLabel: "Revenue chart granularity",
      }),
    );
    expect(html).toContain("Daily");
    expect(html).toContain("granularity=day");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("Revenue chart granularity");
  });
  it("falls back to the default when the value is missing or unknown", () => {
    for (const activeValue of [undefined, "year"]) {
      const html = renderToStaticMarkup(
        createElement(PeriodToggle, {
          options,
          activeValue,
          defaultValue: "auto",
          ariaLabel: "Revenue chart granularity",
        }),
      );
      const automaticLink = html.indexOf("Automatic");
      const currentMark = html.indexOf('aria-current="true"');
      expect(currentMark).toBeGreaterThan(-1);
      expect(currentMark).toBeLessThan(automaticLink);
    }
  });
});

describe("donut chart rendering", () => {
  it("renders the centre total, legend values and links", async () => {
    const { DonutChart } = await import(
      "../src/components/admin/charts/DonutChart"
    );
    const html = renderToStaticMarkup(
      createElement(DonutChart, {
        segments: [
          { label: "Pending", value: 3, href: "/admin/sales/orders?status=pending" },
          { label: "Delivered", value: 1, href: "/admin/sales/orders?status=delivered" },
        ],
        centerLabel: "Orders",
        formatValue: (v: number) => String(v),
        ariaLabel: "Orders by status",
      }),
    );
    expect(html).toContain("<svg");
    expect(html).toContain("Total 4.");
    expect(html).toContain("Pending · 3 (75%)");
    expect(html).toContain("/admin/sales/orders?status=pending");
    expect(html).toContain("rotate(-90 70 70)");
  });
  it("renders the designed empty state with zero data", async () => {
    const { DonutChart } = await import(
      "../src/components/admin/charts/DonutChart"
    );
    const html = renderToStaticMarkup(
      createElement(DonutChart, {
        segments: [{ label: "Pending", value: 0 }],
        centerLabel: "Orders",
        formatValue: (v: number) => String(v),
        ariaLabel: "Orders by status",
        emptyMessage: "No orders in this period.",
      }),
    );
    expect(html).toContain("No orders in this period.");
    expect(html).not.toContain('role="img"');
  });
});

describe("bar chart rendering", () => {
  it("renders bars with values and the data table", async () => {
    const { BarChart } = await import("../src/components/admin/charts/BarChart");
    const html = renderToStaticMarkup(
      createElement(BarChart, {
        bars: [
          { label: "Shirt A", value: 100, compareValue: 50 },
          { label: "Shirt B", value: 200 },
        ],
        formatValue: (v: number) => `X${v}`,
        ariaLabel: "Best sellers",
      }),
    );
    expect(html).toContain("Shirt A: X100");
    expect(html).toContain("View chart data as a table");
  });
  it("renders the designed empty state with zero data", async () => {
    const { BarChart } = await import("../src/components/admin/charts/BarChart");
    const html = renderToStaticMarkup(
      createElement(BarChart, {
        bars: [],
        formatValue: (v: number) => String(v),
        ariaLabel: "Best sellers",
        emptyMessage: "No sales in this period.",
      }),
    );
    expect(html).toContain("No sales in this period.");
  });
});

describe("period toggle without a default", () => {
  const options = [
    { value: "2026-11-15|2026-11-15", label: "Today", href: "/admin/analytics?from=2026-11-15&to=2026-11-15" },
    { value: "2026-11-09|2026-11-15", label: "Last 7 days", href: "/admin/analytics?from=2026-11-09&to=2026-11-15" },
  ];
  it("marks nothing active for a custom range", () => {
    const html = renderToStaticMarkup(
      createElement(PeriodToggle, {
        options,
        activeValue: "2026-11-01|2026-11-10",
        ariaLabel: "Date presets",
      }),
    );
    expect(html).not.toContain('aria-current="true"');
  });
  it("marks the matching preset active", () => {
    const html = renderToStaticMarkup(
      createElement(PeriodToggle, {
        options,
        activeValue: "2026-11-09|2026-11-15",
        ariaLabel: "Date presets",
      }),
    );
    expect(html).toContain('aria-current="true"');
    expect(html.indexOf('aria-current="true"')).toBeLessThan(html.indexOf("Last 7 days"));
  });
});
