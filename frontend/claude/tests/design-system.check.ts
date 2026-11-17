import { describe, expect, it } from "vitest";
import { theme } from "../src/config/theme";
import {
  chartMax,
  chartTotal,
  hasChartData,
} from "../src/design-system/chart-data";
import { cn } from "../src/design-system/cn";
import {
  ADMIN_SCOPE_CLASS,
  adminTokens,
  motionTokens,
  spacingTokens,
  storefrontTokens,
  typographyTokens,
} from "../src/design-system/tokens";
import {
  dataTablePageLabel,
  normalizePageSize,
} from "../src/components/design-system/DataTable";
import { statusBadgeProps } from "../src/components/design-system/StatusBadge";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  ORDER_STATUSES,
} from "../src/lib/admin/constants";

describe("design-system cn", () => {
  it("joins classes and drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("resolves conflicting Tailwind classes to the last one", () => {
    expect(cn("p-4", "p-6")).toBe("p-6");
    expect(cn("text-sm", "text-base")).toBe("text-base");
    expect(cn("bg-admin-bg", "bg-admin-card")).toBe("bg-admin-card");
  });

  it("keeps non-conflicting admin classes together", () => {
    expect(cn("bg-admin-card", "text-admin-text", "border-admin-border")).toBe(
      "bg-admin-card text-admin-text border-admin-border",
    );
  });
});

describe("design tokens: storefront vs admin split", () => {
  it("keeps the storefront primary at #6B0202 from theme.ts", () => {
    expect(storefrontTokens.colors.primary).toBe("#6B0202");
    expect(storefrontTokens.colors.primary).toBe(theme.colors.primary);
    expect(storefrontTokens.colors.primaryDark).toBe("#460101");
    expect(storefrontTokens.colors.background).toBe("#FFFFFF");
    expect(storefrontTokens.colors.surface).toBe("#FFFFFF");
    expect(storefrontTokens.colors.text).toBe("#171717");
    expect(storefrontTokens.colors.textMuted).toBe("#74706C");
    expect(storefrontTokens.colors.border).toBe("#EAEAEA");
    expect(storefrontTokens.colors.selected).toBe("#F6EAEA");
    expect(storefrontTokens.radius.card).toBe("6px");
    expect(storefrontTokens.radius.control).toBe("6px");
  });

  it("exposes Fahim's admin palette as a separate set", () => {
    expect(adminTokens.colors.primary).toBe("#650000");
    expect(adminTokens.colors.secondary).toBe("#8B1E24");
    expect(adminTokens.colors.softBackground).toBe("#F8EEEE");
    expect(adminTokens.colors.background).toBe("#F7F8FA");
    expect(adminTokens.colors.card).toBe("#FFFFFF");
    expect(adminTokens.colors.text).toBe("#172033");
    expect(adminTokens.colors.textSecondary).toBe("#667085");
    expect(adminTokens.colors.border).toBe("#E6E9EF");
    expect(adminTokens.colors.primary).not.toBe(storefrontTokens.colors.primary);
  });

  it("keeps admin channel triplets in sync with the admin hex values", () => {
    expect(adminTokens.channels.primary).toBe("101 0 0");
    expect(adminTokens.channels.secondary).toBe("139 30 36");
    expect(adminTokens.channels.softBackground).toBe("248 238 238");
    expect(adminTokens.channels.background).toBe("247 248 250");
    expect(adminTokens.channels.text).toBe("23 32 51");
    expect(adminTokens.channels.textSecondary).toBe("102 112 133");
    expect(adminTokens.channels.border).toBe("230 233 239");
  });

  it("scopes admin variables under the admin scope class", () => {
    expect(ADMIN_SCOPE_CLASS).toBe("aa-admin-ds");
    expect(adminTokens.css.primary).toBe("rgb(var(--admin-primary))");
    expect(storefrontTokens.css.primary).toBe("rgb(var(--aa-primary))");
  });

  it("keeps admin radii/shadows separate from storefront radii", () => {
    expect(adminTokens.radius.card).toBe("12px");
    expect(adminTokens.radius.control).toBe("8px");
    expect(adminTokens.shadow.card).toContain("rgba(23, 32, 51");
  });

  it("exposes a chart palette led by the admin maroons", () => {
    expect(adminTokens.chart.palette).toHaveLength(8);
    expect(adminTokens.chart.palette[0]).toBe("#650000");
    expect(adminTokens.chart.palette[1]).toBe("#8B1E24");
    expect(adminTokens.chart.grid).toBe("#E6E9EF");
  });

  it("exposes spacing, motion and typography scales", () => {
    expect(spacingTokens.md).toBe("1rem");
    expect(spacingTokens.sectionGap).toBe("1.5rem");
    expect(motionTokens.fast).toBe(150);
    expect(motionTokens.normal).toBe(220);
    expect(motionTokens.ease).toContain("cubic-bezier");
    expect(typographyTokens.pageTitle.size).toBe("1.5rem");
    expect(typographyTokens.fontSans).toContain("Inter");
  });
});

describe("StatusBadge mapping", () => {
  it("covers exactly the fixed 8 order statuses, with no Processing", () => {
    expect(ORDER_STATUSES).toHaveLength(8);
    expect(ORDER_STATUSES).not.toContain("processing");
    expect(ORDER_STATUSES).not.toContain("Processing");
  });

  it("maps every status to its label and tone from constants", () => {
    for (const status of ORDER_STATUSES) {
      expect(statusBadgeProps(status)).toEqual({
        label: ORDER_STATUS_LABELS[status],
        tone: ORDER_STATUS_TONES[status],
      });
    }
  });

  it("labels the hyphenated statuses in words", () => {
    expect(statusBadgeProps("out-for-delivery").label).toBe("Out for Delivery");
    expect(statusBadgeProps("delivered").tone).toBe("success");
    expect(statusBadgeProps("pending").tone).toBe("warning");
    expect(statusBadgeProps("cancelled").tone).toBe("danger");
  });
});

describe("chart data helpers", () => {
  it("treats empty, zero, negative and non-finite series as empty", () => {
    expect(hasChartData([])).toBe(false);
    expect(hasChartData(undefined)).toBe(false);
    expect(hasChartData(null)).toBe(false);
    expect(hasChartData([{ value: 0 }, { value: 0 }])).toBe(false);
    expect(hasChartData([{ value: -5 }])).toBe(false);
    expect(hasChartData([{ value: Number.NaN }])).toBe(false);
    expect(hasChartData([{ value: Number.POSITIVE_INFINITY }])).toBe(false);
  });

  it("treats a series with one positive value as having data", () => {
    expect(hasChartData([{ value: 0 }, { value: 3 }])).toBe(true);
  });

  it("totals finite values and ignores non-finite ones", () => {
    expect(chartTotal([{ value: 2 }, { value: 3 }])).toBe(5);
    expect(chartTotal([{ value: 2 }, { value: Number.NaN }])).toBe(2);
    expect(chartTotal([])).toBe(0);
  });

  it("finds the max finite value, or 0", () => {
    expect(chartMax([{ value: 2 }, { value: 7 }, { value: 4 }])).toBe(7);
    expect(chartMax([{ value: -1 }])).toBe(0);
    expect(chartMax([])).toBe(0);
  });
});

describe("DataTable helpers", () => {
  it("labels the empty table as 0 results", () => {
    expect(
      dataTablePageLabel({ pageIndex: 0, pageSize: 10, total: 0 }),
    ).toBe("0 results");
  });

  it("labels first, middle and partial-last pages", () => {
    expect(
      dataTablePageLabel({ pageIndex: 0, pageSize: 10, total: 42 }),
    ).toBe("1–10 of 42");
    expect(
      dataTablePageLabel({ pageIndex: 1, pageSize: 10, total: 42 }),
    ).toBe("11–20 of 42");
    expect(
      dataTablePageLabel({ pageIndex: 4, pageSize: 10, total: 42 }),
    ).toBe("41–42 of 42");
  });

  it("snaps page sizes to offered options", () => {
    expect(normalizePageSize(25, [10, 25, 50])).toBe(25);
    expect(normalizePageSize(15, [10, 25, 50])).toBe(10);
    expect(normalizePageSize(undefined, [10, 25, 50])).toBe(10);
    expect(normalizePageSize(Number.NaN, [10, 25, 50])).toBe(10);
    expect(normalizePageSize(25, [])).toBe(25);
  });
});
