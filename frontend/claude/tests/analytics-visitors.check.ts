import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISITOR_PERIOD,
  VISITOR_PERIODS,
  VISITOR_PERIOD_LABELS,
  VISITOR_PERIOD_PARAM,
  getVisitorReport,
  parseVisitorPeriod,
} from "../src/app/admin/(workspace)/analytics/visitors";

describe("visitor periods", () => {
  it("lists the four periods in Fahim's order", () => {
    expect([...VISITOR_PERIODS]).toEqual([
      "today",
      "7-days",
      "15-days",
      "1-month",
    ]);
  });

  it("labels each period", () => {
    expect(VISITOR_PERIOD_LABELS).toEqual({
      today: "Today",
      "7-days": "7 days",
      "15-days": "15 days",
      "1-month": "1 month",
    });
  });

  it("uses the visitorsPeriod query param with a 7-day default", () => {
    expect(VISITOR_PERIOD_PARAM).toBe("visitorsPeriod");
    expect(DEFAULT_VISITOR_PERIOD).toBe("7-days");
  });

  it("parses every valid period value", () => {
    for (const period of VISITOR_PERIODS) {
      expect(parseVisitorPeriod(period)).toBe(period);
    }
  });

  it("falls back to the default for missing, unknown, or empty values", () => {
    expect(parseVisitorPeriod(undefined)).toBe(DEFAULT_VISITOR_PERIOD);
    expect(parseVisitorPeriod("30-days")).toBe(DEFAULT_VISITOR_PERIOD);
    expect(parseVisitorPeriod("")).toBe(DEFAULT_VISITOR_PERIOD);
    expect(parseVisitorPeriod([])).toBe(DEFAULT_VISITOR_PERIOD);
  });

  it("takes the first value when the param repeats", () => {
    expect(parseVisitorPeriod(["15-days", "today"])).toBe("15-days");
    expect(parseVisitorPeriod(["bogus", "today"])).toBe(
      DEFAULT_VISITOR_PERIOD,
    );
  });
});

describe("getVisitorReport", () => {
  it("returns the honest unavailable state with no points, for every period, when unconfigured", async () => {
    for (const period of VISITOR_PERIODS) {
      await expect(getVisitorReport(period, { env: {} })).resolves.toEqual({
        status: "unavailable",
        period,
        points: [],
      });
    }
  });

  it("invents no visitor numbers when unconfigured", async () => {
    for (const period of VISITOR_PERIODS) {
      const report = await getVisitorReport(period, { env: {} });
      expect(report.points).toHaveLength(0);
    }
  });

  it("never calls the API when unconfigured, even with a fetch that would succeed", async () => {
    const fetchImpl = () => {
      throw new Error("must not be called");
    };
    for (const period of VISITOR_PERIODS) {
      const report = await getVisitorReport(period, {
        env: {},
        fetchImpl: fetchImpl as typeof fetch,
      });
      expect(report.status).toBe("unavailable");
    }
  });
});
