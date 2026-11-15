import Link from "next/link";
import { ProductThumbnail } from "@/components/admin/access/ProductThumbnail";
import { barFractions } from "./geometry";
import styles from "./HorizontalBarList.module.css";

/**
 * Ranked horizontal bars for product panels (best-selling and
 * least-selling). Each row names the product, shows its units sold and
 * revenue as text, and draws a maroon bar whose length is relative to
 * the largest value in the same panel — the bar is never the only way
 * to read the values. Product names link to the product page.
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
}: {
  items: readonly HorizontalBarItem[];
  /** The measure bar lengths (and the panel's ranking) are relative to. */
  valueKey: "units" | "revenueMinor";
  formatUnits: (value: number) => string;
  formatRevenue: (value: number) => string;
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <p className="aa-muted">{emptyMessage}</p>;
  }
  const fractions = barFractions(items.map((item) => item[valueKey]));
  return (
    <ol className={styles.list}>
      {items.map((item, index) => {
        const fraction = fractions[index] ?? 0;
        const value = item[valueKey];
        return (
          <li key={item.productId} className={styles.row}>
            <div className={styles.rowHeader}>
              <ProductThumbnail url={item.imageUrl} alt={item.imageAlt} />
              <Link
                className={styles.name}
                href={`/admin/catalog/products/${item.productId}`}
              >
                {item.productName}
              </Link>
              <span className={styles.values}>
                {formatUnits(item.units)} units ·{" "}
                {formatRevenue(item.revenueMinor)}
              </span>
            </div>
            <div className={styles.track} aria-hidden="true">
              <div
                className={styles.fill}
                style={{
                  width: `${Math.max(fraction * 100, value > 0 ? 1.5 : 0)}%`,
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
