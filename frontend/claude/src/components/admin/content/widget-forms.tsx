"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";
import {
  WIDGET_PLACEMENTS,
  WIDGET_PLACEMENT_LABELS,
  WIDGET_THEMES,
  WIDGET_THEME_LABELS,
  WIDGET_TYPES,
  WIDGET_TYPE_LABELS,
  type WidgetType,
} from "@/lib/admin/reference-adapt";
import styles from "@/components/admin/admin-v2-forms.module.css";

type FormAction = (
  prev: AdminActionResult | null,
  form: FormData,
) => Promise<AdminActionResult>;

export interface WidgetFormInitial {
  id: string;
  title: string;
  type: WidgetType;
  placement: string;
  title_visible: boolean;
  title_alignment: string;
  title_size: string;
  subtitle: string;
  /** Datetime-local value in Asia/Dhaka, or "" when unset. */
  ends_at: string;
  offer_title: string;
  discount_text: string;
  style_theme: string;
  use_theme_color: boolean;
  background_color: string;
  accent_color: string;
  title_color: string;
  content_color: string;
  sort_position: string;
  active: boolean;
}

/**
 * Widget create/edit form. Countdown widgets require an end date; the
 * field only renders for that type. Custom colors apply only when
 * "Use theme colors" is off.
 */
export function WidgetForm({
  initial,
  action,
}: {
  initial: WidgetFormInitial | null;
  action: FormAction;
}) {
  const [type, setType] = useState<WidgetType>(initial?.type ?? "countdown");
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} method="post">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="widget-title">Title</label>
          <input
            id="widget-title"
            name="title"
            required
            maxLength={120}
            defaultValue={initial?.title ?? ""}
            placeholder="Winter Sale"
          />
        </div>
        <div className="aa-field">
          <label htmlFor="widget-type">Type</label>
          <select
            id="widget-type"
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as WidgetType)}
          >
            {WIDGET_TYPES.map((widgetType) => (
              <option key={widgetType} value={widgetType}>
                {WIDGET_TYPE_LABELS[widgetType]}
              </option>
            ))}
          </select>
        </div>
        <div className="aa-field">
          <label htmlFor="widget-placement">Placement</label>
          <select
            id="widget-placement"
            name="placement"
            defaultValue={initial?.placement ?? "after-hero"}
          >
            {WIDGET_PLACEMENTS.map((placement) => (
              <option key={placement} value={placement}>
                {WIDGET_PLACEMENT_LABELS[placement]}
              </option>
            ))}
          </select>
          <p className="aa-hint">
            The widget renders after that homepage section, only when the
            section itself is enabled.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor="widget-sort">Display order</label>
          <input
            id="widget-sort"
            name="sort_position"
            type="number"
            min={0}
            max={999}
            step={1}
            defaultValue={initial?.sort_position ?? "0"}
          />
          <p className="aa-hint">Lower numbers render first at the same placement.</p>
        </div>
        <div className="aa-field aa-field--full">
          <label htmlFor="widget-subtitle">Subtitle (optional)</label>
          <input
            id="widget-subtitle"
            name="subtitle"
            maxLength={200}
            defaultValue={initial?.subtitle ?? ""}
          />
        </div>
        {type === "countdown" ? (
          <div className="aa-field">
            <label htmlFor="widget-ends">End date and time</label>
            <input
              id="widget-ends"
              name="ends_at"
              type="datetime-local"
              required
              defaultValue={initial?.ends_at ?? ""}
            />
            <p className="aa-hint">
              Dhaka time. The countdown stops rendering once this passes.
            </p>
          </div>
        ) : null}
        <div className="aa-field">
          <label htmlFor="widget-offer">Offer title (optional)</label>
          <input
            id="widget-offer"
            name="offer_title"
            maxLength={120}
            defaultValue={initial?.offer_title ?? ""}
          />
        </div>
        <div className="aa-field">
          <label htmlFor="widget-discount">Discount text (optional)</label>
          <input
            id="widget-discount"
            name="discount_text"
            maxLength={120}
            defaultValue={initial?.discount_text ?? ""}
            placeholder="Up to 30% off"
          />
        </div>
      </div>

      <fieldset className={styles.group} style={{ marginTop: "1rem" }}>
        <legend className={styles.groupTitle}>Title display</legend>
        <div className="aa-check-row">
          <label>
            <input
              type="checkbox"
              name="title_visible"
              defaultChecked={initial?.title_visible ?? true}
            />{" "}
            Show the title on the storefront
          </label>
        </div>
        <div className="aa-form-grid">
          <div className="aa-field">
            <label htmlFor="widget-align">Title alignment</label>
            <select
              id="widget-align"
              name="title_alignment"
              defaultValue={initial?.title_alignment ?? "left"}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
            </select>
          </div>
          <div className="aa-field">
            <label htmlFor="widget-size">Title size</label>
            <select
              id="widget-size"
              name="title_size"
              defaultValue={initial?.title_size ?? "medium"}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className={styles.group} style={{ marginTop: "1rem" }}>
        <legend className={styles.groupTitle}>Section style</legend>
        <div className="aa-form-grid">
          <div className="aa-field">
            <label htmlFor="widget-theme">Theme</label>
            <select
              id="widget-theme"
              name="style_theme"
              defaultValue={initial?.style_theme ?? "default"}
            >
              {WIDGET_THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {WIDGET_THEME_LABELS[theme]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="aa-check-row">
          <label>
            <input
              type="checkbox"
              name="use_theme_color"
              defaultChecked={initial?.use_theme_color ?? true}
            />{" "}
            Use theme colors
          </label>
        </div>
        <p className="aa-hint">
          Custom colors below apply only when theme colors are off. Leave a
          field empty to keep that theme color.
        </p>
        <div className="aa-form-grid">
          <div className="aa-field">
            <label htmlFor="widget-bg">Background color</label>
            <input
              id="widget-bg"
              name="background_color"
              maxLength={7}
              defaultValue={initial?.background_color ?? ""}
              placeholder="#FFFFFF"
              spellCheck={false}
            />
          </div>
          <div className="aa-field">
            <label htmlFor="widget-accent">Accent color</label>
            <input
              id="widget-accent"
              name="accent_color"
              maxLength={7}
              defaultValue={initial?.accent_color ?? ""}
              placeholder="#6B0202"
              spellCheck={false}
            />
          </div>
          <div className="aa-field">
            <label htmlFor="widget-title-color">Title color</label>
            <input
              id="widget-title-color"
              name="title_color"
              maxLength={7}
              defaultValue={initial?.title_color ?? ""}
              placeholder="#1A1A1A"
              spellCheck={false}
            />
          </div>
          <div className="aa-field">
            <label htmlFor="widget-content-color">Text color</label>
            <input
              id="widget-content-color"
              name="content_color"
              maxLength={7}
              defaultValue={initial?.content_color ?? ""}
              placeholder="#444444"
              spellCheck={false}
            />
          </div>
        </div>
      </fieldset>

      <div className="aa-check-row">
        <label>
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial?.active ?? false}
          />{" "}
          Active — show on the storefront
        </label>
      </div>
      <p className="aa-hint">
        Only active widgets render, and countdowns stop at their end date.
        Inactive widgets are stored but never shown.
      </p>
      <div className="aa-form-actions">
        <SubmitButton>{initial ? "Save widget" : "Add widget"}</SubmitButton>
      </div>
    </form>
  );
}
