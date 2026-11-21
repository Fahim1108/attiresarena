"use client";

import { useActionState, useState } from "react";
import { StatusBadge } from "@/components/admin/ui";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";
import { robotsPreview } from "@/lib/admin/reference-adapt";
import {
  PIXEL_EVENTS,
  SEO_PAGE_SLUGS,
  parsePixelEvents,
  parseSeoRobots,
  parseSeoSitemap,
  settingString,
  type PixelEventName,
  type StoreSettingsMap,
} from "@/lib/admin/settings-shared";
import styles from "@/components/admin/admin-v2-forms.module.css";

type FormAction = (
  prev: AdminActionResult | null,
  form: FormData,
) => Promise<AdminActionResult>;

const PAGE_LABELS: Record<string, string> = {
  home: "Home",
  shop: "Shop",
  about: "About",
  contact: "Contact",
};

/** Plain-language meaning of each Pixel event, and whether it fires today. */
const PIXEL_EVENT_DESCRIPTIONS: Record<
  PixelEventName,
  { description: string; live: boolean }
> = {
  PageView: {
    description: "Someone opens any page on the store.",
    live: true,
  },
  ViewContent: {
    description: "Someone opens a product page.",
    live: false,
  },
  AddToCart: {
    description: "Someone adds a product to the cart.",
    live: false,
  },
  InitiateCheckout: {
    description: "Someone starts checkout.",
    live: false,
  },
  Purchase: {
    description: "Someone completes an order.",
    live: false,
  },
};

function overrideValue(
  settings: StoreSettingsMap,
  slug: string,
  field: "title" | "description",
): string {
  const raw = settings["seo_page_overrides"];
  if (typeof raw !== "object" || raw === null) return "";
  const page = (raw as Record<string, unknown>)[slug];
  if (typeof page !== "object" || page === null) return "";
  const value = (page as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

export function SeoSettingsForm({
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
          <label htmlFor="seo-default-title">Default title</label>
          <input
            id="seo-default-title"
            name="seo_default_title"
            defaultValue={settingString(settings, "seo_default_title")}
            maxLength={200}
          />
        </div>
        <div className="aa-field">
          <label htmlFor="seo-default-description">Default description</label>
          <input
            id="seo-default-description"
            name="seo_default_description"
            defaultValue={settingString(settings, "seo_default_description")}
            maxLength={500}
          />
        </div>
        {SEO_PAGE_SLUGS.map((slug) => (
          <div className="aa-field aa-field--full" key={slug}>
            <h3 style={{ marginBottom: 0 }}>{PAGE_LABELS[slug]} page</h3>
            <div className="aa-form-grid">
              <div className="aa-field">
                <label htmlFor={`seo-${slug}-title`}>Title override</label>
                <input
                  id={`seo-${slug}-title`}
                  name={`seo_${slug}_title`}
                  defaultValue={overrideValue(settings, slug, "title")}
                  maxLength={200}
                />
              </div>
              <div className="aa-field">
                <label htmlFor={`seo-${slug}-description`}>Description override</label>
                <input
                  id={`seo-${slug}-description`}
                  name={`seo_${slug}_description`}
                  defaultValue={overrideValue(settings, slug, "description")}
                  maxLength={500}
                />
              </div>
            </div>
            <p className="aa-hint">Leave empty to use the default title and description.</p>
          </div>
        ))}
      </div>
      <div className="aa-form-actions">
        <SubmitButton>Save SEO settings</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Extended SEO: keywords, Open Graph, Twitter card, canonical URL, robots
 * and sitemap toggles. Saved values apply to page metadata on the next
 * page load, except the sitemap toggles (no sitemap exists yet) and the
 * per-page overrides above (need per-page metadata wiring).
 */
export function SeoExtendedForm({
  action,
  settings,
}: {
  action: FormAction;
  settings: StoreSettingsMap;
}) {
  const [state, formAction] = useActionState(action, null);
  const [robots, setRobots] = useState(
    () =>
      parseSeoRobots(settings["seo_robots"]) ?? {
        index: false,
        follow: false,
      },
  );
  const preview = robotsPreview(robots);
  const sitemap = parseSeoSitemap(settings["seo_sitemap"]) ?? {
    includeShop: false,
    includeCategories: false,
    includePolicies: false,
    includeProducts: false,
  };
  const twitterCard = settingString(settings, "seo_twitter_card");
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field aa-field--full">
          <label htmlFor="seo-keywords">Keywords</label>
          <input
            id="seo-keywords"
            name="seo_keywords"
            autoComplete="off"
            defaultValue={settingString(settings, "seo_keywords")}
            maxLength={500}
            placeholder="thrift shirts, menswear, Dhaka…"
          />
          <p className="aa-hint">Comma-separated. Leave empty for no keywords tag.</p>
        </div>
        <div className="aa-field">
          <label htmlFor="seo-og-title">Sharing title (Open Graph)</label>
          <input
            id="seo-og-title"
            name="seo_og_title"
            autoComplete="off"
            defaultValue={settingString(settings, "seo_og_title")}
            maxLength={200}
          />
        </div>
        <div className="aa-field">
          <label htmlFor="seo-og-description">Sharing description (Open Graph)</label>
          <input
            id="seo-og-description"
            name="seo_og_description"
            autoComplete="off"
            defaultValue={settingString(settings, "seo_og_description")}
            maxLength={500}
          />
        </div>
        <div className="aa-field aa-field--full">
          <label htmlFor="seo-og-image">Sharing image URL (Open Graph)</label>
          <input
            id="seo-og-image"
            name="seo_og_image_url"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            defaultValue={settingString(settings, "seo_og_image_url")}
            maxLength={500}
            placeholder="https://…"
          />
          <p className="aa-hint">
            A full public image URL. The private social sharing image below
            cannot be used here — sharing previews need a public URL.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor="seo-twitter-card">Twitter card type</label>
          <select
            id="seo-twitter-card"
            name="seo_twitter_card"
            defaultValue={
              twitterCard === "summary" ? "summary" : "summary_large_image"
            }
          >
            <option value="summary_large_image">Large image</option>
            <option value="summary">Summary</option>
          </select>
          <p className="aa-hint">
            Choosing a card type adds Twitter card tags using the sharing
            title and description.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor="seo-canonical">Canonical base URL</label>
          <input
            id="seo-canonical"
            name="seo_canonical_base_url"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            defaultValue={settingString(settings, "seo_canonical_base_url")}
            maxLength={500}
            placeholder="https://attiresarena.com…"
          />
          <p className="aa-hint">
            Leave empty to use the store&apos;s own address.
          </p>
        </div>
      </div>
      <h3 className={styles.groupTitle} style={{ marginTop: "1rem" }}>
        Robots &amp; Sitemap
      </h3>
      <fieldset className={styles.group} style={{ marginTop: "0.5rem" }}>
        <legend className={styles.groupTitle}>Search engine robots</legend>
        <div className={styles.checkList}>
          <label>
            <input
              type="checkbox"
              name="seo_robots_index"
              checked={robots.index}
              onChange={(event) =>
                setRobots((current) => ({ ...current, index: event.target.checked }))
              }
            />
            <span>Allow search engines to index the store</span>
          </label>
          <label>
            <input
              type="checkbox"
              name="seo_robots_follow"
              checked={robots.follow}
              onChange={(event) =>
                setRobots((current) => ({ ...current, follow: event.target.checked }))
              }
            />
            <span>Allow search engines to follow links</span>
          </label>
        </div>
        <p className={styles.groupNote}>
          Both off means search engines are asked not to index or follow.
          The store stays hidden from search until you turn indexing on.
        </p>
        <div className={styles.groupNote} aria-label="Robots preview">
          <p>
            Preview — meta robots: <code>{preview.metaRobots}</code>
          </p>
          <pre style={{ whiteSpace: "pre-wrap", margin: "0.25rem 0 0" }}>
            {preview.robotsTxt}
          </pre>
          <p style={{ marginTop: "0.25rem" }}>
            Simplified preview. The live robots.txt follows the index
            choice on the production store — it also disallows private
            pages and links the sitemap when indexing is on — and always
            refuses crawling on preview deployments. The follow choice is
            a page-level directive, not a robots.txt rule.
          </p>
        </div>
      </fieldset>
      <fieldset className={styles.group} style={{ marginTop: "0.75rem" }}>
        <legend className={styles.groupTitle}>Sitemap</legend>
        <div className={styles.checkList}>
          <label>
            <input
              type="checkbox"
              name="seo_sitemap_shop"
              defaultChecked={sitemap.includeShop}
            />
            <span>Include the shop page</span>
          </label>
          <label>
            <input
              type="checkbox"
              name="seo_sitemap_categories"
              defaultChecked={sitemap.includeCategories}
            />
            <span>Include category pages</span>
          </label>
          <label>
            <input
              type="checkbox"
              name="seo_sitemap_policies"
              defaultChecked={sitemap.includePolicies}
            />
            <span>Include policy pages</span>
          </label>
          <label>
            <input
              type="checkbox"
              name="seo_sitemap_products"
              defaultChecked={sitemap.includeProducts}
            />
            <span>Include product pages</span>
          </label>
        </div>
        <p className={styles.groupNote}>
          The live sitemap follows these choices on the production store
          when indexing is on; it returns empty while indexing is off or
          on preview deployments. The home, about, contact, and FAQ pages
          are always included.
        </p>
      </fieldset>
      <fieldset className={styles.group} style={{ marginTop: "0.75rem" }}>
        <legend className={styles.groupTitle}>Search Console verification</legend>
        <div className="aa-field">
          <label htmlFor="seo-gsc-verification">Google Search Console verification token</label>
          <input
            id="seo-gsc-verification"
            name="google_search_console_verification"
            spellCheck={false}
            autoComplete="off"
            defaultValue={settingString(settings, "google_search_console_verification")}
            maxLength={500}
            placeholder="Paste the token from Google Search Console…"
          />
          <p className="aa-hint">
            From Search Console&apos;s HTML-tag method. It renders as a
            google-site-verification meta tag on the store homepage so
            Google can verify ownership. Leave empty to remove it.
          </p>
        </div>
      </fieldset>
      <div className="aa-form-actions">
        <SubmitButton>Save extended SEO settings</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Meta Pixel and Google Analytics configuration. Tracking
 * scripts load only when their ID is saved; with no ID saved, no
 * third-party tracking code loads at all. SMS is not connected:
 * no provider is set up and no message is sent from this panel,
 * so the SMS fields were removed rather than left to imply a
 * working feature.
 */
export function MarketingSettingsForm({
  action,
  settings,
}: {
  action: FormAction;
  settings: StoreSettingsMap;
}) {
  const [state, formAction] = useActionState(action, null);
  const pixelId = settingString(settings, "meta_pixel_id");
  const gaId = settingString(settings, "ga_measurement_id");
  const events = parsePixelEvents(settings["meta_pixel_events"]) ?? {
    PageView: true,
    ViewContent: false,
    AddToCart: false,
    InitiateCheckout: false,
    Purchase: false,
  };
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <section
        className={styles.panel}
        aria-labelledby="marketing-pixel-heading"
      >
        <div className={styles.panelHeader}>
          <h3 id="marketing-pixel-heading" className={styles.panelTitle}>
            Meta Pixel
          </h3>
          {pixelId ? (
            <StatusBadge tone="success">Configured</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Not configured</StatusBadge>
          )}
        </div>
        <p className={styles.panelNote}>
          {pixelId
            ? "Configured — the Pixel loads on every store page."
            : "Not configured — no Pixel code loads on the store."}
        </p>
        <div className="aa-form-grid">
          <div className="aa-field">
            <label htmlFor="meta-pixel-id">Meta Pixel ID</label>
            <input
              id="meta-pixel-id"
              name="meta_pixel_id"
              inputMode="numeric"
              spellCheck={false}
              autoComplete="off"
              defaultValue={pixelId}
              maxLength={20}
              placeholder="123456789012345…"
            />
            <p className="aa-hint">
              Numbers only. Find it in Meta Events Manager → Data sources
              → your Pixel — the number shown under its name. Clear the
              field to stop loading the Pixel.
            </p>
          </div>
        </div>
        <fieldset className={styles.group} style={{ marginTop: "0.75rem" }}>
          <legend className={styles.groupTitle}>Pixel events</legend>
          <div className={styles.checkList}>
            {PIXEL_EVENTS.map((event) => {
              const info = PIXEL_EVENT_DESCRIPTIONS[event];
              return (
                <label key={event} className={styles.eventRow}>
                  <input
                    type="checkbox"
                    name={`pixel_${event}`}
                    defaultChecked={events[event]}
                  />
                  <span>
                    <strong>{event}</strong>
                    <span className={styles.eventDesc}>
                      {info.description}{" "}
                      {info.live
                        ? "Fires today when the Pixel loads."
                        : "Not wired yet — does not fire."}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className={styles.groupNote}>
            Only PageView fires today. The other events are stored here and
            will fire once their pages are wired to send them.
          </p>
        </fieldset>
      </section>
      <section
        className={styles.panel}
        aria-labelledby="marketing-ga-heading"
      >
        <div className={styles.panelHeader}>
          <h3 id="marketing-ga-heading" className={styles.panelTitle}>
            Google Analytics
          </h3>
          {gaId ? (
            <StatusBadge tone="success">Configured</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Not configured</StatusBadge>
          )}
        </div>
        <p className={styles.panelNote}>
          {gaId
            ? "Configured — Analytics loads on every store page."
            : "Not configured — no Analytics code loads on the store."}
        </p>
        <div className="aa-form-grid">
          <div className="aa-field">
            <label htmlFor="ga-measurement-id">Measurement ID</label>
            <input
              id="ga-measurement-id"
              name="ga_measurement_id"
              spellCheck={false}
              autoComplete="off"
              defaultValue={gaId}
              maxLength={24}
              placeholder="G-XXXXXXXXXX…"
            />
            <p className="aa-hint">
              Starts with G-. Find it in Google Analytics → Admin → Data
              Streams → Web — the Measurement ID. Clear the field to stop
              loading Google Analytics.
            </p>
          </div>
        </div>
      </section>
      <p className="aa-hint" role="note">
        SMS is not connected: no provider is set up and no message is
        sent from this panel. SMS settings will return when a provider
        is added.
      </p>
      <p className="aa-hint" style={{ marginTop: "0.25rem" }}>
        Saving applies on the next page load — tracking code starts or stops
        loading then.
      </p>
      <div className="aa-form-actions">
        <SubmitButton>Save marketing settings</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Owner-only custom header/footer code. The risk note is part of the form,
 * in plain language: the code runs on every page and can break the site.
 */
export function CustomCodeForm({
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
      <div className={styles.riskNote} role="note">
        <strong>Read this before saving.</strong> Custom code runs on every
        page of the store. Wrong code can break the site for every visitor,
        slow pages down, or send visitor data somewhere you did not intend.
        Only the owner can save or remove it. Never paste code you do not
        understand, and never put passwords, API keys or secrets in here —
        this code is visible to anyone who views the page. To stop the code
        running, clear the box and save.
      </div>
      <div className="aa-form-grid">
        <div className="aa-field aa-field--full">
          <label htmlFor="custom-head-code">Header code (top of every page)</label>
          <textarea
            id="custom-head-code"
            name="custom_head_code"
            className={styles.codeInput}
            spellCheck={false}
            autoComplete="off"
            defaultValue={settingString(settings, "custom_head_code")}
            maxLength={20000}
            rows={7}
            placeholder="<!-- Header code… -->"
          />
          <p className="aa-hint">
            Runs at the top of every page. For scripts and tracking code.
          </p>
        </div>
        <div className="aa-field aa-field--full">
          <label htmlFor="custom-body-code">Footer code (end of every page)</label>
          <textarea
            id="custom-body-code"
            name="custom_body_code"
            className={styles.codeInput}
            spellCheck={false}
            autoComplete="off"
            defaultValue={settingString(settings, "custom_body_code")}
            maxLength={20000}
            rows={7}
            placeholder="<!-- Footer code… -->"
          />
          <p className="aa-hint">
            Runs at the end of every page, after the store content.
          </p>
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>Save custom code</SubmitButton>
      </div>
    </form>
  );
}
