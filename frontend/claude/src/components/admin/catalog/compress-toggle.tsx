"use client";

import {
  MAX_COMPRESSIBLE_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
} from "@/lib/admin/catalog-variants";
import {
  COMPRESSOR_MAX_LONG_EDGE,
  formatBytes,
} from "./image-compress";
import styles from "./catalogue-v2.module.css";

/**
 * Auto-compressor toggle, shared by the product gallery, the staged
 * pre-upload panel and the category image fields. Presented as a card
 * row with a switch (reference: Media Manager auto-compress card),
 * adapted to the AttiresArena theme. The switch is a real checkbox,
 * keyboard-operable and labelled; the track/knob are pure styling.
 */
export function CompressToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={styles.compressCard}>
      <div className={styles.compressCardText}>
        <p className={styles.compressCardTitle}>Auto-compress images</p>
        <p className="aa-hint" style={{ margin: 0 }}>
          {checked
            ? `On: photos are resized to at most ${COMPRESSOR_MAX_LONG_EDGE}px and saved as WebP before upload (originals up to ${formatBytes(MAX_COMPRESSIBLE_IMAGE_BYTES)} accepted). The original file is not kept.`
            : `Off: originals are uploaded untouched (up to ${formatBytes(MAX_IMAGE_BYTES)} each).`}
        </p>
      </div>
      <label className={styles.switch}>
        <input
          type="checkbox"
          className={styles.switchInput}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label="Auto-compress images"
        />
        <span className={styles.switchTrack} aria-hidden="true">
          <span className={styles.switchKnob} />
        </span>
      </label>
    </div>
  );
}
