"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  ConfirmSubmit,
  DangerSubmitButton,
  FormMessage,
  SubmitButton,
  type RowAction,
} from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";
import {
  deliveryDistrictOptions,
  parseLowStockThreshold,
  settingNumber,
  settingString,
  type StoreSettingsMap,
  type TestDataEraseCounts,
} from "@/lib/admin/settings-shared";

type FormAction = (
  prev: AdminActionResult | null,
  form: FormData,
) => Promise<AdminActionResult>;

export function StoreSettingsForm({
  action,
  settings,
}: {
  action: FormAction;
  settings: StoreSettingsMap;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="store-name">Store name</label>
          <input
            id="store-name"
            name="store_name"
            defaultValue={settingString(settings, "store_name")}
            maxLength={120}
            required
          />
        </div>
        <div className="aa-field">
          <label htmlFor="contact-phone">Contact phone</label>
          <input
            id="contact-phone"
            name="contact_phone"
            type="tel"
            defaultValue={settingString(settings, "contact_phone")}
            maxLength={40}
          />
        </div>
        <div className="aa-field">
          <label htmlFor="contact-email">Contact email</label>
          <input
            id="contact-email"
            name="contact_email"
            type="email"
            spellCheck={false}
            defaultValue={settingString(settings, "contact_email")}
            maxLength={254}
          />
        </div>
        <div className="aa-field">
          <label htmlFor="whatsapp-number">WhatsApp number</label>
          <input
            id="whatsapp-number"
            name="whatsapp_number"
            type="tel"
            defaultValue={settingString(settings, "whatsapp_number")}
            maxLength={20}
            placeholder="01XXXXXXXXX"
          />
          <p className="aa-hint">Digits only, optionally starting with +.</p>
        </div>
        <div className="aa-field aa-field--full">
          <label htmlFor="contact-address">Contact address</label>
          <input
            id="contact-address"
            name="contact_address"
            defaultValue={settingString(settings, "contact_address")}
            maxLength={500}
          />
        </div>
        <div className="aa-field">
          <label htmlFor="social-facebook">Facebook URL</label>
          <input
            id="social-facebook"
            name="social_facebook"
            inputMode="url"
            spellCheck={false}
            defaultValue={settingString(settings, "social_facebook")}
            maxLength={500}
            placeholder="https://facebook.com/…"
          />
        </div>
        <div className="aa-field">
          <label htmlFor="social-instagram">Instagram URL</label>
          <input
            id="social-instagram"
            name="social_instagram"
            inputMode="url"
            spellCheck={false}
            defaultValue={settingString(settings, "social_instagram")}
            maxLength={500}
            placeholder="https://instagram.com/…"
          />
        </div>
        <div className="aa-field">
          <label htmlFor="social-youtube">YouTube URL</label>
          <input
            id="social-youtube"
            name="social_youtube"
            inputMode="url"
            spellCheck={false}
            defaultValue={settingString(settings, "social_youtube")}
            maxLength={500}
            placeholder="https://youtube.com/…"
          />
        </div>
        <div className="aa-field">
          <label htmlFor="social-tiktok">TikTok URL</label>
          <input
            id="social-tiktok"
            name="social_tiktok"
            inputMode="url"
            spellCheck={false}
            defaultValue={settingString(settings, "social_tiktok")}
            maxLength={500}
            placeholder="https://tiktok.com/…"
          />
        </div>
        <div className="aa-field aa-field--full">
          <label htmlFor="footer-about">Footer about text</label>
          <textarea
            id="footer-about"
            name="footer_about"
            defaultValue={settingString(settings, "footer_about")}
            maxLength={1000}
            rows={3}
          />
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>Save store settings</SubmitButton>
      </div>
    </form>
  );
}

export function StoreNameForm({
  action,
  settings,
}: {
  action: FormAction;
  settings: StoreSettingsMap;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="theme-store-name">Store name</label>
          <input
            id="theme-store-name"
            name="store_name"
            defaultValue={settingString(settings, "store_name")}
            maxLength={120}
            required
          />
          <p className="aa-hint">Only the store name is changed by this form.</p>
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>Save store name</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Contact phone + email only. saveStoreSettings updates only the keys
 * present in the submitted form, so the rest of the store settings are
 * untouched by this form.
 */
export function ContactDetailsForm({
  action,
  settings,
}: {
  action: FormAction;
  settings: StoreSettingsMap;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="general-contact-phone">Contact phone</label>
          <input
            id="general-contact-phone"
            name="contact_phone"
            type="tel"
            defaultValue={settingString(settings, "contact_phone")}
            maxLength={40}
          />
        </div>
        <div className="aa-field">
          <label htmlFor="general-contact-email">Contact email</label>
          <input
            id="general-contact-email"
            name="contact_email"
            type="email"
            spellCheck={false}
            defaultValue={settingString(settings, "contact_email")}
            maxLength={254}
          />
        </div>
      </div>
      <p className="aa-hint">Only the contact phone and email are changed by this form.</p>
      <div className="aa-form-actions">
        <SubmitButton>Save contact details</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Light general display settings: currency label, timezone label and the
 * low-stock threshold display value. Display-only — none of these change
 * prices, dates or inventory behaviour.
 */
export function GeneralDisplayForm({
  action,
  settings,
}: {
  action: FormAction;
  settings: StoreSettingsMap;
}) {
  const [state, formAction] = useActionState(action, null);
  const threshold = parseLowStockThreshold(settings["low_stock_threshold"]);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="display-currency">Currency display</label>
          <input
            id="display-currency"
            name="display_currency"
            autoComplete="off"
            defaultValue={settingString(settings, "display_currency") || "BDT"}
            maxLength={12}
            required
          />
          <p className="aa-hint">
            The store sells in BDT (Bangladeshi Taka) only. This label does
            not change prices.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor="display-timezone">Timezone display</label>
          <input
            id="display-timezone"
            name="display_timezone"
            autoComplete="off"
            defaultValue={settingString(settings, "display_timezone") || "Asia/Dhaka"}
            maxLength={64}
            required
          />
          <p className="aa-hint">
            Display label only. Dates in the admin use Asia/Dhaka.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor="low-stock-threshold">Low-stock threshold</label>
          <input
            id="low-stock-threshold"
            name="low_stock_threshold"
            type="number"
            inputMode="numeric"
            min={0}
            max={999}
            defaultValue={threshold ?? 5}
            required
          />
          <p className="aa-hint">
            Display value only. Inventory low-stock flags come from the
            inventory records themselves.
          </p>
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>Save general settings</SubmitButton>
      </div>
    </form>
  );
}

export function BrandImageForm({
  action,
  clearAction,
  kind,
  label,
  currentUrl,
  hasCurrent,
}: {
  action: FormAction;
  clearAction: RowAction;
  kind: "logo" | "favicon" | "social";
  label: string;
  currentUrl: string | null;
  hasCurrent: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <div>
      <form action={formAction} encType="multipart/form-data">
        <FormMessage state={state} />
        <input type="hidden" name="kind" value={kind} />
        <div className="aa-form-grid">
          <div className="aa-field">
            <label htmlFor={`brand-image-${kind}`}>{label}</label>
            <input
              id={`brand-image-${kind}`}
              name="image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required
            />
            <p className="aa-hint">JPEG, PNG or WebP, up to 768 KiB. Stored privately; shown here via a signed URL.</p>
          </div>
        </div>
        {currentUrl ? (
          <p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentUrl}
              alt={`Current ${label.toLowerCase()}`}
              width={120}
              height={120}
              style={{ objectFit: "contain", marginTop: "0.5rem" }}
            />
          </p>
        ) : null}
        <div className="aa-form-actions">
          <SubmitButton>Upload {label.toLowerCase()}</SubmitButton>
        </div>
      </form>
      {hasCurrent ? (
        <div style={{ marginTop: "0.5rem" }}>
          <ConfirmSubmit
            action={clearAction}
            fields={{ kind }}
            buttonLabel={`Remove saved ${label.toLowerCase()}`}
            ariaLabel={`Remove saved ${label.toLowerCase()}`}
            confirmTitle={`Remove the saved ${label.toLowerCase()}?`}
            confirmBody={`The stored ${label.toLowerCase()} is cleared. You can upload a new one afterwards.`}
            confirmLabel="Remove image"
          />
        </div>
      ) : null}
    </div>
  );
}

export function DeliverySettingsForm({
  action,
  settings,
}: {
  action: FormAction;
  settings: StoreSettingsMap;
}) {
  const [state, formAction] = useActionState(action, null);
  const insideDistrict =
    settingString(settings, "delivery_inside_district") || "Barishal";
  const insideChargeMinor =
    settingNumber(settings, "delivery_inside_charge_minor") ?? 5000;
  const outsideChargeMinor =
    settingNumber(settings, "delivery_outside_charge_minor") ?? 14000;
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field aa-field--full">
          <label htmlFor="delivery-inside-district">Inside district</label>
          <select
            id="delivery-inside-district"
            name="delivery_inside_district"
            defaultValue={insideDistrict}
            required
          >
            {deliveryDistrictOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="aa-hint">
            Orders delivered in this district pay the Inside charge; every
            other district pays the Outside charge.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor="delivery-inside-charge">
            Inside delivery charge (৳)
          </label>
          <input
            id="delivery-inside-charge"
            name="delivery_inside_charge_taka"
            type="number"
            inputMode="numeric"
            min={0}
            max={10000}
            step={1}
            defaultValue={Math.round(insideChargeMinor / 100)}
            required
          />
          <p className="aa-hint">Charged for orders inside the district above.</p>
        </div>
        <div className="aa-field">
          <label htmlFor="delivery-outside-charge">
            Outside delivery charge (৳)
          </label>
          <input
            id="delivery-outside-charge"
            name="delivery_outside_charge_taka"
            type="number"
            inputMode="numeric"
            min={0}
            max={10000}
            step={1}
            defaultValue={Math.round(outsideChargeMinor / 100)}
            required
          />
          <p className="aa-hint">Charged for orders in every other district.</p>
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>Save delivery settings</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Test data erase (migration 20261123000100, owner-only). Shows the live
 * counts of what the erase will remove, then asks for a typed ERASE
 * confirmation inside a dialog — the same dialog + danger-submit idiom
 * as ConfirmSubmit, with the extra typed word because this action is
 * irreversible. The counts come from the same RPC predicates as the
 * erase itself, so the preview can never disagree with the delete.
 * Nothing is deleted when counts cannot be loaded or when everything
 * is already zero.
 */
export function TestDataEraseForm({
  action,
  counts,
}: {
  action: FormAction;
  counts: TestDataEraseCounts | null;
}) {
  const [state, formAction] = useActionState(action, null);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const bodyId = useId();
  // Close the dialog once the action reports back, so the inline outcome
  // below the button is visible instead of hidden behind it. The
  // confirmation text resets when the dialog closes (onClose below), not
  // here — calling setState inside this effect would cascade renders.
  useEffect(() => {
    if (state !== null) {
      dialog.current?.close();
    }
  }, [state]);
  const rows: { label: string; value: number }[] =
    counts === null
      ? []
      : [
          { label: "Orders", value: counts.orders },
          { label: "Payment records (TxID)", value: counts.payment_submissions },
          { label: "Checkout sessions", value: counts.checkout_sessions },
          { label: "Test products", value: counts.test_products },
          { label: "Customer accounts", value: counts.customers },
          { label: "Reviews", value: counts.product_reviews },
          { label: "Coupons", value: counts.coupons },
          { label: "Banners", value: counts.banners },
        ];
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const shownNames = counts?.test_product_names.slice(0, 10) ?? [];
  const hiddenNames = (counts?.test_product_names.length ?? 0) - shownNames.length;
  return (
    <div>
      <FormMessage state={state} />
      {counts === null ? (
        <p className="aa-notice aa-notice--warning">
          Erase counts could not be loaded — the erase migration may not be
          applied on this database yet. The button stays disabled until the
          counts load.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-admin-text-secondary">
            Permanently deletes every order, payment record, checkout
            session, TEST-named product, customer account, review, coupon
            and banner listed below. Categories, settings, delivery
            charges, payment numbers, admin accounts and the audit log are
            never touched. This cannot be undone.
          </p>
          <ul className="mb-4 text-sm">
            {rows.map((row) => (
              <li
                key={row.label}
                className="flex justify-between border-b border-admin-border py-1 last:border-b-0"
              >
                <span>{row.label}</span>
                <strong className="admin-ds-numeric">{row.value}</strong>
              </li>
            ))}
          </ul>
          {shownNames.length > 0 ? (
            <p className="mb-4 text-sm text-admin-text-secondary">
              Test products: {shownNames.join(", ")}
              {hiddenNames > 0 ? ` and ${hiddenNames} more` : ""}.
            </p>
          ) : null}
          {total === 0 ? (
            <p className="aa-notice aa-notice--success">
              Nothing to erase — all counts are already zero.
            </p>
          ) : null}
        </>
      )}
      <div className="aa-form-actions">
        <button
          type="button"
          className="aa-row-action aa-row-action--danger"
          disabled={counts === null || total === 0}
          aria-label="Erase all test data"
          onClick={() => {
            setOpen(true);
            dialog.current?.showModal();
          }}
        >
          Erase test data
        </button>
      </div>
      <dialog
        ref={dialog}
        className="aa-dialog"
        onClose={() => {
          setOpen(false);
          setConfirmText("");
        }}
        aria-label="Erase all test data"
        aria-describedby={bodyId}
      >
        {open ? (
          <form action={formAction} method="post">
            <h2>Erase all test data?</h2>
            <p id={bodyId}>
              This permanently deletes {total} items — orders, payment
              records, checkout sessions, TEST-named products, customer
              accounts, reviews, coupons and banners. Categories,
              settings, delivery charges, payment numbers, admin accounts
              and the audit log stay. This cannot be undone.
            </p>
            <div className="aa-field">
              <label htmlFor="erase-confirmation">Type ERASE to confirm</label>
              <input
                id="erase-confirmation"
                name="confirmation"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoComplete="off"
                placeholder="ERASE"
                maxLength={5}
              />
            </div>
            <div className="aa-dialog-actions">
              <button
                type="button"
                className="aa-secondary"
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              <DangerSubmitButton
                pendingLabel="Erasing…"
                disabled={confirmText !== "ERASE"}
              >
                Erase test data
              </DangerSubmitButton>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
