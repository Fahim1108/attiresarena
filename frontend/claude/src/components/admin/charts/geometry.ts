/**
 * Pure chart geometry for the hand-built admin charts (no React imports,
 * so the math is unit-tested directly in tests/admin-charts.check.ts).
 * No chart dependency exists in this repo and none is added.
 */

/** One pie input value: the label is carried through for the slice. */
export interface PieSliceInput {
  label: string;
  value: number;
}

export interface ComputedPieSlice {
  /** Index of the segment in the caller's original order (for colours). */
  sourceIndex: number;
  label: string;
  value: number;
  /** Share of the total, 0–1. */
  share: number;
  /** Start/end angles in degrees, 0° at 12 o'clock, clockwise. */
  startAngle: number;
  endAngle: number;
  /** SVG path for the slice (empty when `isFullCircle`). */
  path: string;
  /** Centroid position for a direct label, in a 0–200 viewBox. */
  labelX: number;
  labelY: number;
  /** True when a single slice takes the whole pie (an arc cannot draw 360°). */
  isFullCircle: boolean;
}

export const PIE_CENTER = 100;
export const PIE_RADIUS = 96;
/** Direct % labels are drawn only on slices at least this large. */
export const PIE_DIRECT_LABEL_MIN_SHARE = 0.12;

/** Donut geometry shares the pie's 0–200 viewBox and centre. */
export const DONUT_CENTER = 100;
export const DONUT_OUTER_RADIUS = 96;
export const DONUT_INNER_RADIUS = 58;

function piePoint(angleDegrees: number, radius: number): { x: number; y: number } {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: PIE_CENTER + radius * Math.cos(radians),
    y: PIE_CENTER + radius * Math.sin(radians),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Slice geometry for a full pie. Slices are ordered largest-first so the
 * largest slice starts at 12 o'clock; zero and negative values produce no
 * slice (the legend still lists them). Angles always sum to 360° across
 * the returned slices. Empty or all-zero input returns no slices.
 */
export function computePieSlices(
  segments: readonly PieSliceInput[],
): ComputedPieSlice[] {
  const total = segments.reduce(
    (sum, segment) => sum + Math.max(segment.value, 0),
    0,
  );
  if (total <= 0) return [];
  const ordered = segments
    .map((segment, sourceIndex) => ({ segment, sourceIndex }))
    .filter(({ segment }) => segment.value > 0)
    .sort((a, b) => b.segment.value - a.segment.value);
  let cursor = 0;
  return ordered.map(({ segment, sourceIndex }) => {
    const share = segment.value / total;
    const startAngle = cursor;
    const endAngle = cursor + share * 360;
    cursor = endAngle;
    const isFullCircle = share >= 1;
    const midAngle = (startAngle + endAngle) / 2;
    const labelPoint = piePoint(midAngle, PIE_RADIUS * 0.62);
    if (isFullCircle) {
      return {
        sourceIndex,
        label: segment.label,
        value: segment.value,
        share,
        startAngle: 0,
        endAngle: 360,
        path: "",
        labelX: round2(labelPoint.x),
        labelY: round2(labelPoint.y),
        isFullCircle: true,
      };
    }
    const start = piePoint(startAngle, PIE_RADIUS);
    const end = piePoint(endAngle, PIE_RADIUS);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return {
      sourceIndex,
      label: segment.label,
      value: segment.value,
      share,
      startAngle: round2(startAngle),
      endAngle: round2(endAngle),
      path: `M${PIE_CENTER},${PIE_CENTER} L${round2(start.x)},${round2(start.y)} A${PIE_RADIUS},${PIE_RADIUS} 0 ${largeArc},1 ${round2(end.x)},${round2(end.y)} Z`,
      labelX: round2(labelPoint.x),
      labelY: round2(labelPoint.y),
      isFullCircle: false,
    };
  });
}

/**
 * Slice geometry for a donut ring (annular slices around a centre hole
 * for the total). Ordering, filtering and angle rules match
 * computePieSlices exactly: largest first from 12 o'clock, zero and
 * negative values produce no slice, angles sum to 360°. Unlike the pie,
 * a full-circle slice carries a real path: outer and inner circles in
 * one path, drawn with fill-rule evenodd so the hole stays transparent
 * (no assumption about the panel background). Direct labels sit on the
 * ring mid-radius.
 */
export interface ComputedDonutSlice {
  sourceIndex: number;
  label: string;
  value: number;
  share: number;
  startAngle: number;
  endAngle: number;
  /** SVG path for the ring slice (never empty when a slice exists). */
  path: string;
  labelX: number;
  labelY: number;
  isFullCircle: boolean;
}

export function computeDonutSlices(
  segments: readonly PieSliceInput[],
): ComputedDonutSlice[] {
  const total = segments.reduce(
    (sum, segment) => sum + Math.max(segment.value, 0),
    0,
  );
  if (total <= 0) return [];
  const ordered = segments
    .map((segment, sourceIndex) => ({ segment, sourceIndex }))
    .filter(({ segment }) => segment.value > 0)
    .sort((a, b) => b.segment.value - a.segment.value);
  let cursor = 0;
  return ordered.map(({ segment, sourceIndex }) => {
    const share = segment.value / total;
    const startAngle = cursor;
    const endAngle = cursor + share * 360;
    cursor = endAngle;
    const isFullCircle = share >= 1;
    const midAngle = (startAngle + endAngle) / 2;
    const labelPoint = piePoint(
      midAngle,
      (DONUT_OUTER_RADIUS + DONUT_INNER_RADIUS) / 2,
    );
    const base = {
      sourceIndex,
      label: segment.label,
      value: segment.value,
      share,
      labelX: round2(labelPoint.x),
      labelY: round2(labelPoint.y),
      isFullCircle,
    };
    if (isFullCircle) {
      const outer = DONUT_OUTER_RADIUS;
      const inner = DONUT_INNER_RADIUS;
      const c = DONUT_CENTER;
      return {
        ...base,
        startAngle: 0,
        endAngle: 360,
        path:
          `M${c},${c - outer} A${outer},${outer} 0 1,1 ${c},${c + outer} ` +
          `A${outer},${outer} 0 1,1 ${c},${c - outer} Z ` +
          `M${c},${c - inner} A${inner},${inner} 0 1,0 ${c},${c + inner} ` +
          `A${inner},${inner} 0 1,0 ${c},${c - inner} Z`,
      };
    }
    const outerStart = piePoint(startAngle, DONUT_OUTER_RADIUS);
    const outerEnd = piePoint(endAngle, DONUT_OUTER_RADIUS);
    const innerEnd = piePoint(endAngle, DONUT_INNER_RADIUS);
    const innerStart = piePoint(startAngle, DONUT_INNER_RADIUS);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return {
      ...base,
      startAngle: round2(startAngle),
      endAngle: round2(endAngle),
      path:
        `M${round2(outerStart.x)},${round2(outerStart.y)} ` +
        `A${DONUT_OUTER_RADIUS},${DONUT_OUTER_RADIUS} 0 ${largeArc},1 ${round2(outerEnd.x)},${round2(outerEnd.y)} ` +
        `L${round2(innerEnd.x)},${round2(innerEnd.y)} ` +
        `A${DONUT_INNER_RADIUS},${DONUT_INNER_RADIUS} 0 ${largeArc},0 ${round2(innerStart.x)},${round2(innerStart.y)} Z`,
    };
  });
}

/**
 * Readable label ink for a slice colour: white on dark fills, near-black
 * on light fills, decided by relative luminance (WCAG threshold 0.179).
 * Unparseable colours fall back to dark ink on the assumption the fill
 * is light; every palette colour in this repo parses.
 */
export function pieSliceLabelColor(hex: string): "#FFFFFF" | "#171717" {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  const raw = match?.[1];
  if (!raw) return "#171717";
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : raw;
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  const luminance =
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0);
  return luminance > 0.179 ? "#171717" : "#FFFFFF";
}

/**
 * Horizontal gridline values for a series chart: 0, 25%, 50%, 75% and
 * 100% of the plotted maximum. A zero maximum yields a single 0 line
 * (callers render the empty state instead of the chart in that case).
 */
export function seriesGridTicks(max: number): number[] {
  if (!(max > 0)) return [0];
  return [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * max);
}

/**
 * Indexes of the x-axis labels to draw: evenly spaced, always including
 * the first and last point, at most `maxLabels`. Short series label
 * every point.
 */
export function seriesLabelIndexes(
  count: number,
  maxLabels = 6,
): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) {
    return Array.from({ length: count }, (_, index) => index);
  }
  const step = (count - 1) / (maxLabels - 1);
  const indexes: number[] = [];
  for (let slot = 0; slot < maxLabels; slot += 1) {
    const index = Math.round(slot * step);
    if (!indexes.includes(index)) indexes.push(index);
  }
  if (indexes[indexes.length - 1] !== count - 1) {
    indexes[indexes.length - 1] = count - 1;
  }
  return indexes;
}

/**
 * Bar lengths as fractions of the largest value (0–1). Negative values
 * clamp to 0 and an all-zero series yields all zeroes, so callers never
 * divide by zero or draw a negative bar.
 */
export function barFractions(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  if (max <= 0) return values.map(() => 0);
  return values.map((value) => Math.max(value, 0) / max);
}

/** A plotted point in SVG coordinates (already scaled by the caller). */
export interface SeriesDot {
  x: number;
  y: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function dotText(dot: SeriesDot): string {
  return `${round1(dot.x)},${round1(dot.y)}`;
}

/**
 * Smooth wave path through the dots (Catmull-Rom splines converted to
 * cubic Bézier segments, so the curve passes through every plotted
 * point — the shape is smoothed, the values are not changed). One
 * decimal place keeps SVG precision low without visible stepping.
 * Fewer than three dots draw straight: a single dot is a move only,
 * two dots are one straight segment.
 */
export function smoothLinePath(dots: readonly SeriesDot[]): string {
  if (dots.length === 0) return "";
  const first = dots[0];
  if (!first) return "";
  if (dots.length === 1) return `M${dotText(first)}`;
  if (dots.length === 2) {
    const second = dots[1];
    if (!second) return `M${dotText(first)}`;
    return `M${dotText(first)} L${dotText(second)}`;
  }
  let path = `M${dotText(first)}`;
  for (let index = 0; index < dots.length - 1; index += 1) {
    const p0 = dots[index - 1] ?? dots[index];
    const p1 = dots[index];
    const p2 = dots[index + 1];
    const p3 = dots[index + 2] ?? dots[index + 1];
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C${round1(c1x)},${round1(c1y)} ${round1(c2x)},${round1(c2y)} ${dotText(p2)}`;
  }
  return path;
}

/**
 * Area fill under a line path: the line, dropped to the baseline and
 * closed. An empty line yields an empty area (callers render the empty
 * state instead).
 */
export function areaPathFromLine(
  linePath: string,
  firstX: number,
  lastX: number,
  baseY: number,
): string {
  if (!linePath) return "";
  return `${linePath} L${round1(lastX)},${round1(baseY)} L${round1(firstX)},${round1(baseY)} Z`;
}
