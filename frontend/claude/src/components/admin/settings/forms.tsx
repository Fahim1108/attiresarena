"use client";

import { useActionState } from "react";
import {
  ConfirmSubmit,
  FormMessage,
  SubmitButton,
} from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";
import {
  parseLowStockThreshold,
  settingString,
  type StoreSettingsMap,
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
  clearAction: (form: FormData) => void | Promise<void>;
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
