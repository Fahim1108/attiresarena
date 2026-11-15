"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setCatalogProductPublication } from "@/lib/admin/catalog-products";
import {
  publicationVisibilityLabel,
  type PublicationVisibility,
} from "@/lib/admin/catalog-variants";
import { StatusBadge } from "../ui";
import styles from "./catalogue-v2.module.css";

/**
 * Publish / unpublish controls for one product (list rows + edit page).
 * Publish is a single visible, labelled button; unpublish — which
 * removes the product from the storefront at once — uses the same
 * two-step inline confirmation as the other destructive row actions.
 * Buttons are always visible and labelled; nothing is hover-reveal.
 */
export function PublicationActions({
  productId,
  productName,
  visibility,
  canManage,
}: {
  productId: string;
  productName: string;
  visibility: PublicationVisibility;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    kind: "info" | "error";
  } | null>(null);

  const run = async (publish: boolean) => {
    setBusy(true);
    const result = await setCatalogProductPublication(productId, publish);
    setMessage(
      result.ok
        ? { text: result.message, kind: "info" }
        : { text: result.error, kind: "error" },
    );
    setConfirmUnpublish(false);
    setBusy(false);
    router.refresh();
  };

  const tone =
    visibility === "visible"
      ? "success"
      : visibility === "paused"
        ? "warning"
        : "neutral";

  return (
    <span className={styles.publicationActions}>
      <StatusBadge tone={tone}>
        {publicationVisibilityLabel(visibility)}
      </StatusBadge>
      {canManage ? (
        visibility === "visible" || visibility === "paused" ? (
          confirmUnpublish ? (
            <>
              <button
                type="button"
                className="aa-row-action aa-row-action--danger"
                disabled={busy}
                aria-label={`Confirm unpublish ${productName}`}
                onClick={() => void run(false)}
              >
                Confirm unpublish
              </button>
              <button
                type="button"
                className="aa-row-action"
                disabled={busy}
                aria-label={`Cancel unpublishing ${productName}`}
                onClick={() => setConfirmUnpublish(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {visibility === "paused" ? (
                <button
                  type="button"
                  className="aa-row-action"
                  disabled={busy}
                  aria-label={`Publish ${productName} to the storefront`}
                  onClick={() => void run(true)}
                >
                  Publish
                </button>
              ) : null}
              <button
                type="button"
                className="aa-row-action aa-row-action--danger"
                disabled={busy}
                aria-label={`Unpublish ${productName}`}
                onClick={() => setConfirmUnpublish(true)}
              >
                Unpublish
              </button>
            </>
          )
        ) : (
          <button
            type="button"
            className="aa-row-action"
            disabled={busy}
            aria-label={`Publish ${productName} to the storefront`}
            onClick={() => void run(true)}
          >
            Publish
          </button>
        )
      ) : null}
      {message ? (
        <span
          role={message.kind === "error" ? "alert" : "status"}
          className={`${styles.publicationMessage} ${message.kind === "error" ? styles.publicationMessageError : ""}`}
        >
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
