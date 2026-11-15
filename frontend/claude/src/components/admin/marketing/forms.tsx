"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";
import {
  SEO_PAGE_SLUGS,
  settingString,
  type StoreSettingsMap,
} from "@/lib/admin/settings-shared";

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
