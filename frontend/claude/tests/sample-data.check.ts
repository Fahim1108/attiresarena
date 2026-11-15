import { describe, it, expect } from "vitest";
import {
  resolveDisplayData,
  resolveDisplayRecord,
} from "../src/lib/admin/sample-data";

const sample = [
  { id: "sample-1", name: "Sample Kurti" },
  { id: "sample-2", name: "Sample Saree" },
];

describe("resolveDisplayData", () => {
  it("shows the sample dataset, flagged, when live data is unavailable (null)", () => {
    const result = resolveDisplayData(null, sample);
    expect(result.isSample).toBe(true);
    expect(result.items).toEqual(sample);
  });

  it("returns a copy of the sample dataset, never the dataset itself", () => {
    const result = resolveDisplayData(null, sample);
    expect(result.items).not.toBe(sample);
    result.items.pop();
    expect(sample).toHaveLength(2);
  });

  it("treats a live empty array as genuinely empty, never sample", () => {
    const result = resolveDisplayData([], sample);
    expect(result.isSample).toBe(false);
    expect(result.items).toEqual([]);
  });

  it("returns live rows as-is, unflagged, when the query succeeded", () => {
    const live = [{ id: "live-1", name: "Real Kurti" }];
    const result = resolveDisplayData(live, sample);
    expect(result.isSample).toBe(false);
    expect(result.items).toEqual(live);
  });

  it("returns a copy of live rows so display sorting cannot mutate the loader result", () => {
    const live = [{ id: "live-1", name: "Real Kurti" }];
    const result = resolveDisplayData(live, sample);
    expect(result.items).not.toBe(live);
    result.items.pop();
    expect(live).toHaveLength(1);
  });

  it("never mixes sample rows into live rows", () => {
    const live = [{ id: "live-1", name: "Real Kurti" }];
    const result = resolveDisplayData(live, sample);
    expect(result.items.some((item) => item.id.startsWith("sample-"))).toBe(false);
  });
});

describe("resolveDisplayRecord", () => {
  it("shows the sample record, flagged, when the live record is unavailable (null)", () => {
    const result = resolveDisplayRecord(null, sample[0]!);
    expect(result.isSample).toBe(true);
    expect(result.record).toEqual(sample[0]);
  });

  it("returns the live record as-is, unflagged, when the query succeeded", () => {
    const live = { id: "live-1", name: "Real Kurti" };
    const result = resolveDisplayRecord(live, sample[0]!);
    expect(result.isSample).toBe(false);
    expect(result.record).toBe(live);
  });
});
