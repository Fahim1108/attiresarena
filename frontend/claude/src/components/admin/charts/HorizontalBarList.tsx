import Link from "next/link";
import { ProductThumbnail } from "@/components/admin/access/ProductThumbnail";
import { ChartEmptyState } from "./ChartEmptyState";
import { barFractions } from "./geometry";
import styles from "./HorizontalBarList.module.css";

/**
 * Ranked horizontal bars for product panels (best-selling and
 * least-selling). Each row names the product, shows its units sold and
 * revenue as text — the ranked measure in bold — and draws a maroon
 * bar whose length is relative to the largest value in the same panel;
 * the bar is never the only way to read the values. Product names link
 * to the product page. Bars grow from the left with a short stagger;
 * reduced motion shows them at full length immediately.
 *
 * Bar lengths are relative within one panel only: the two panels rank
 * by different measures (revenue vs units), so a bar in one panel must
 * not be compared with a bar in the other.
 */

export interface HorizontalBarItem {
  productId: string;
  productName: string;
  imageUrl: string | null;
  imageAlt: string;
  units: number;
  revenueMinor: number;
}

export function HorizontalBarList({
  items,
  valueKey,
  formatUnits,
  formatRevenue,
  emptyMessage = "No sales in this period.",
  emptyGuidance = "Sales appear here once orders are placed in the selected period.",
}: {
  items: readonly HorizontalBarItem[];
  /** The measure bar lengths (and the panel's ranking) are relative to. */
  valueKey: "units" | "revenueMinor";
  formatUnits: (value: number) => string;
  formatRevenue: (value: number) => string;
  emptyMessage?: string;
  /** Guidance shown under the empty-state title. */
  emptyGuidance?: string;
}) {
  if (items.length === 0) {
    return <ChartEmptyState title={emptyMessage} guidance={emptyGuidance} />;
  }
  const fractions = barFractions(items.map((item) => item[valueKey]));
  return (
    <ol className={styles.list}>
      {items.map((item, index) => {
        const fraction = fractions[index] ?? 0;
        const value = item[valueKey];
        const unitsText = (
          <>
            {formatUnits(item.units)} units
          </>
        );
        const revenueText = formatRevenue(item.revenueMinor);
        return (
          <li key={item.productId} className={styles.row}>
            <div className={styles.rowHeader}>
              <span className={styles.rank} aria-hidden="true">
                {index + 1}
              </span>
              <ProductThumbnail url={item.imageUrl} alt={item.imageAlt} />
              <Link
                className={styles.name}
                href={`/admin/catalog/products/${item.productId}`}
              >
                {item.productName}
              </Link>
              <span className={styles.values}>
                {valueKey === "units" ? (
                  <>
                    <strong>{unitsText}</strong> · {revenueText}
                  </>
                ) : (
                  <>
                    {unitsText} · <strong>{revenueText}</strong>
                  </>
                )}
              </span>
            </div>
            <div className={styles.track} aria-hidden="true">
              <div
                className={styles.fill}
                style={{
                  width: `${Math.max(fraction * 100, value > 0 ? 1.5 : 0)}%`,
                  animationDelay: `${index * 60}ms`,
                }}
              />
            </div>
            <span className="aa-sr-only">
              Rank {index + 1} of {items.length}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
