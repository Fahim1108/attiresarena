import Link from "next/link";
import { LinkPendingHint } from "./LinkPendingHint";
import { segmentedActiveIndex } from "./period-toggle";
import styles from "./PeriodToggle.module.css";

/**
 * Segmented period toggle: a pill of links, one per option, where the
 * active option is the one matching the current query value (or the
 * default when the query value is missing or unknown). Links keep the
 * behaviour the toolbar already had — every option is a deep link,
 * keyboard-operable, and preserves the other query params through
 * the hrefs the caller builds. Each option carries a LinkPendingHint:
 * a fixed-size dot that appears the instant its navigation is pending,
 * so a slow toggle no longer looks stuck. The toggle itself stays a
 * server component; only the hint ships client JavaScript.
 */
export interface PeriodToggleOption {
  /** Query value for this option (compared with `activeValue`). */
  value: string;
  label: string;
  href: string;
}

export function PeriodToggle({
  options,
  activeValue,
  defaultValue,
  ariaLabel,
}: {
  options: readonly PeriodToggleOption[];
  /** Current query value, or undefined when the param is absent. */
  activeValue: string | undefined;
  /**
   * Value treated as active when `activeValue` is absent or unknown.
   * Omit it when no option may be marked active for an unmatched
   * value (e.g. preset periods with a custom date range selected).
   */
  defaultValue?: string;
  ariaLabel: string;
}) {
  const values = options.map((option) => option.value);
  const matched = activeValue === undefined ? -1 : values.indexOf(activeValue);
  const defaultIndex =
    defaultValue === undefined
      ? -1
      : segmentedActiveIndex(values, activeValue, Math.max(values.indexOf(defaultValue), 0));
  const activeIndex = matched >= 0 ? matched : defaultIndex;
  return (
    <span className={styles.control} role="group" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const active = index === activeIndex;
        return (
          <Link
            key={option.value}
            href={option.href}
            aria-current={active ? "true" : undefined}
            className={active ? styles.optionActive : styles.option}
          >
            {option.label}
            <LinkPendingHint />
          </Link>
        );
      })}
    </span>
  );
}
