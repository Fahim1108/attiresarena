"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";
import {
  BODY_FONT_IDS,
  BUTTON_SHAPES,
  BUTTON_STYLES,
  FONT_OPTIONS,
  FONT_STACKS,
  HEADING_FONT_IDS,
  type CustomizeButtons,
  type CustomizeTypography,
  type FontOptionId,
} from "@/lib/admin/reference-adapt";

type FormAction = (
  prev: AdminActionResult | null,
  form: FormData,
) => Promise<AdminActionResult>;

function fontLabel(id: FontOptionId): string {
  return FONT_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

/**
 * Typography + button style editor with a live preview. The preview uses
 * the store's already-loaded font families and the maroon theme color;
 * the Bangla preview lines are copied from the storefront's own checkout
 * copy (PaymentInstructions / ManualAdvancePayment), not from any
 * reference material. Saved choices are stored only — the storefront
 * theme is unchanged until a follow-up wires them through CSS variables.
 */
export function CustomizeForm({
  initialTypography,
  initialButtons,
  action,
}: {
  initialTypography: CustomizeTypography;
  initialButtons: CustomizeButtons;
  action: FormAction;
}) {
  const [state, formAction] = useActionState(action, null);
  const [headingFont, setHeadingFont] = useState<FontOptionId>(
    initialTypography.heading_font,
  );
  const [bodyFont, setBodyFont] = useState<FontOptionId>(
    initialTypography.body_font,
  );
  const [buttonStyle, setButtonStyle] = useState<CustomizeButtons["style"]>(
    initialButtons.style,
  );
  const [buttonShape, setButtonShape] = useState<CustomizeButtons["shape"]>(
    initialButtons.shape,
  );
  const [radiusPx, setRadiusPx] = useState<number>(initialButtons.radius_px);

  const buttonRadius =
    buttonShape === "square" ? 0 : buttonShape === "pill" ? 999 : radiusPx;

  return (
    <form action={formAction} method="post">
      <FormMessage state={state} />
      <input
        type="hidden"
        name="typography_value"
        value={JSON.stringify({
          heading_font: headingFont,
          body_font: bodyFont,
        })}
      />
      <input
        type="hidden"
        name="buttons_value"
        value={JSON.stringify({
          style: buttonStyle,
          shape: buttonShape,
          radius_px: radiusPx,
        })}
      />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="customize-heading-font">Heading font</label>
          <select
            id="customize-heading-font"
            value={headingFont}
            onChange={(event) => setHeadingFont(event.target.value as FontOptionId)}
          >
            {HEADING_FONT_IDS.map((id) => (
              <option key={id} value={id}>
                {fontLabel(id)}
              </option>
            ))}
          </select>
        </div>
        <div className="aa-field">
          <label htmlFor="customize-body-font">Body font</label>
          <select
            id="customize-body-font"
            value={bodyFont}
            onChange={(event) => setBodyFont(event.target.value as FontOptionId)}
          >
            {BODY_FONT_IDS.map((id) => (
              <option key={id} value={id}>
                {fontLabel(id)}
              </option>
            ))}
          </select>
        </div>
        <div className="aa-field">
          <label htmlFor="customize-button-style">Button style</label>
          <select
            id="customize-button-style"
            value={buttonStyle}
            onChange={(event) =>
              setButtonStyle(event.target.value as CustomizeButtons["style"])
            }
          >
            {BUTTON_STYLES.map((style) => (
              <option key={style} value={style}>
                {style === "solid" ? "Solid" : "Outline"}
              </option>
            ))}
          </select>
        </div>
        <div className="aa-field">
          <label htmlFor="customize-button-shape">Button shape</label>
          <select
            id="customize-button-shape"
            value={buttonShape}
            onChange={(event) =>
              setButtonShape(event.target.value as CustomizeButtons["shape"])
            }
          >
            {BUTTON_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {shape === "square" ? "Square" : shape === "rounded" ? "Rounded" : "Pill"}
              </option>
            ))}
          </select>
        </div>
        <div className="aa-field">
          <label htmlFor="customize-button-radius">
            Button corner radius (px)
          </label>
          <input
            id="customize-button-radius"
            type="number"
            min={0}
            max={24}
            step={1}
            value={radiusPx}
            disabled={buttonShape !== "rounded"}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              setRadiusPx(Number.isFinite(parsed) ? parsed : 6);
            }}
          />
          <p className="aa-hint">
            Applies to the Rounded shape only. The storefront default is 6px.
          </p>
        </div>
      </div>

      <div
        aria-label="Live preview"
        style={{
          marginTop: "1rem",
          padding: "1rem",
          border: "1px solid #eaeaea",
          borderRadius: "6px",
          background: "#ffffff",
        }}
      >
        <p className="aa-hint" style={{ marginTop: 0 }}>
          Live preview — heading, body and button in the selected styles.
        </p>
        <h3
          style={{
            fontFamily: FONT_STACKS[headingFont],
            fontSize: "1.6rem",
            fontWeight: 500,
            color: "#171717",
            margin: "0 0 0.5rem",
          }}
        >
          New Collection
        </h3>
        <h4
          lang="bn"
          style={{
            fontFamily: FONT_STACKS[headingFont],
            fontSize: "1.25rem",
            fontWeight: 500,
            color: "#171717",
            margin: "0 0 0.5rem",
          }}
        >
          যেভাবে পেমেন্ট করবেন
        </h4>
        <p
          style={{
            fontFamily: FONT_STACKS[bodyFont],
            fontSize: "1rem",
            lineHeight: 1.5,
            color: "#444444",
            margin: "0 0 0.5rem",
          }}
        >
          Soft cotton shirts, cut for everyday comfort and made to last.
        </p>
        <p
          lang="bn"
          style={{
            fontFamily: FONT_STACKS[bodyFont],
            fontSize: "1rem",
            lineHeight: 1.5,
            color: "#444444",
            margin: "0 0 1rem",
          }}
        >
          ডেলিভারি চার্জ বাদে বাকি টাকা প্রোডাক্ট হাতে পেয়ে পরিশোধ করুন।
        </p>
        <span
          style={{
            display: "inline-block",
            padding: "0.625rem 1.25rem",
            borderRadius: buttonRadius,
            border: "1px solid #6b0202",
            background: buttonStyle === "solid" ? "#6b0202" : "transparent",
            color: buttonStyle === "solid" ? "#ffffff" : "#6b0202",
            fontFamily: FONT_STACKS[bodyFont],
            fontWeight: 600,
          }}
        >
          Shop now
        </span>
      </div>

      <p className="aa-hint">
        Saved heading/body fonts and button shape apply on the storefront
        on the next page load. Button style (solid/outline) is not applied
        yet — the storefront has no single button style to switch.
      </p>
      <div className="aa-form-actions">
        <SubmitButton>Save customize settings</SubmitButton>
      </div>
    </form>
  );
}
