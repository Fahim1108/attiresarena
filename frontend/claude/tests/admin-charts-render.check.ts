import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PieChart } from "../src/components/admin/charts/PieChart";
import { SeriesChart } from "../src/components/admin/charts/SeriesChart";
import { HorizontalBarList } from "../src/components/admin/charts/HorizontalBarList";

/**
 * Server-rendered smoke checks for the dashboard charts: honest empty
 * states with zero data (no fabricated numbers, no crash) and the
 * populated render (values, totals, links). Geometry math is covered
 * separately in admin-charts.check.ts.
 */
describe("dashboard chart rendering", () => {
  it("renders honest empty states with zero data", () => {
    const pie = renderToStaticMarkup(
      createElement(PieChart, {
        segments: [
          { label: "Pending", value: 0 },
          { label: "Delivered", value: 0 },
        ],
        totalLabel: "orders",
        formatValue: (v: number) => String(v),
        ariaLabel: "Orders by status",
        emptyMessage: "No orders in this period.",
      }),
    );
    expect(pie).toContain("No orders in this period.");
    expect(pie).not.toContain("<svg");
    const series = renderToStaticMarkup(
      createElement(SeriesChart, {
        points: [{ label: "1 Nov", value: 0 }],
        formatValue: (v: number) => String(v),
        ariaLabel: "Revenue",
        emptyMessage: "No revenue in this period.",
      }),
    );
    expect(series).toContain("No revenue in this period.");
    const bars = renderToStaticMarkup(
      createElement(HorizontalBarList, {
        items: [],
        valueKey: "units",
        formatUnits: (v: number) => String(v),
        formatRevenue: (v: number) => String(v),
        emptyMessage: "No sales in this period.",
      }),
    );
    expect(bars).toContain("No sales in this period.");
  });
  it("renders populated charts with values and links", () => {
    const pie = renderToStaticMarkup(
      createElement(PieChart, {
        segments: [
          { label: "Pending", value: 3, href: "/admin/sales/orders?status=pending" },
          { label: "Delivered", value: 1, href: "/admin/sales/orders?status=delivered" },
        ],
        totalLabel: "orders",
        formatValue: (v: number) => String(v),
        ariaLabel: "Orders by status",
      }),
    );
    expect(pie).toContain("<svg");
    expect(pie).toContain("Total 4 orders");
    expect(pie).toContain("Pending · 3 (75%)");
    expect(pie).toContain("/admin/sales/orders?status=pending");
    const bars = renderToStaticMarkup(
      createElement(HorizontalBarList, {
        items: [
          { productId: "p1", productName: "Shirt A", imageUrl: null, imageAlt: "Shirt A", units: 2, revenueMinor: 1000 },
        ],
        valueKey: "units",
        formatUnits: (v: number) => String(v),
        formatRevenue: (v: number) => `BDT ${v}`,
        emptyMessage: "No sales in this period.",
      }),
    );
    expect(bars).toContain("Shirt A");
    expect(bars).toContain("2 units");
    expect(bars).toContain("/admin/catalog/products/p1");
    const series = renderToStaticMarkup(
      createElement(SeriesChart, {
        points: [
          { label: "1 Nov", value: 100 },
          { label: "2 Nov", value: 200 },
        ],
        comparePoints: [
          { label: "1 Nov", value: 50 },
          { label: "2 Nov", value: 60 },
        ],
        formatValue: (v: number) => `X${v}`,
        ariaLabel: "Revenue",
      }),
    );
    expect(series).toContain("<svg");
    expect(series).toContain("X200");
    expect(series).toContain("View chart data as a table");
  });
});
