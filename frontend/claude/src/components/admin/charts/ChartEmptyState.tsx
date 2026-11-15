import styles from "./ChartEmptyState.module.css";

/**
 * Designed honest empty state for the hand-built charts: a titled,
 * guidance-carrying placeholder instead of a blank box or a bare
 * muted line. It never invents data — the title names what is absent
 * and the guidance says what will make it appear. Shared by
 * SeriesChart, PieChart, DonutChart, BarChart and HorizontalBarList
 * so every chart's empty state looks intentional.
 */
export function ChartEmptyState({
  title,
  guidance,
  className,
}: {
  title: string;
  guidance?: string;
  className?: string;
}) {
  return (
    <div className={className ? `${styles.empty} ${className}` : styles.empty}>
      <svg
        className={styles.glyph}
        viewBox="0 0 48 24"
        width="48"
        height="24"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M2,18 C10,18 12,8 20,10 C28,12 30,20 38,16 C42,14 45,15 46,15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <p className={styles.title}>{title}</p>
      {guidance ? <p className={styles.guidance}>{guidance}</p> : null}
    </div>
  );
}
