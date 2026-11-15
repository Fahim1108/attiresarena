import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RadioOptionGroup } from "@/components/admin/catalog/radio-option-cards";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function inputTags(html: string): string[] {
  return html.match(/<input[^>]*>/g) ?? [];
}

function tagValue(tag: string): string {
  return tag.match(/value="([^"]*)"/)?.[1] ?? "";
}

function luminance(hex: string): number {
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i + 1, i + 3), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function ratio(fg: string, bg: string): number {
  const sorted = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (sorted[0]! + 0.05) / (sorted[1]! + 0.05);
}

const productOptions = (status: "published" | "archived") => [
  {
    value: "published",
    label: "Active",
    hint: "Published in the admin panel",
    defaultChecked: status === "published",
  },
  {
    value: "archived",
    label: "Inactive",
    hint: "Archived",
    defaultChecked: status === "archived",
  },
];

const renderProductGroup = (status: "published" | "archived") =>
  renderToStaticMarkup(
    createElement(RadioOptionGroup, {
      name: "status",
      ariaLabel: "Product status",
      describedBy: "product-status-error",
      options: productOptions(status),
    }),
  );

describe("radio option cards", () => {
  it("renders a labelled radiogroup of two native radios under one name", () => {
    const html = renderProductGroup("published");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Product status"');
    expect(html).toContain('aria-describedby="product-status-error"');
    const inputs = inputTags(html);
    expect(inputs).toHaveLength(2);
    for (const tag of inputs) {
      expect(tag).toContain('type="radio"');
      expect(tag).toContain('name="status"');
      expect(tag).not.toContain("disabled");
    }
    expect(inputs.map(tagValue).sort()).toEqual(["archived", "published"]);
  });

  it("selects the published option by default and leaves the other unselected", () => {
    const inputs = inputTags(renderProductGroup("published"));
    const byValue = new Map(inputs.map((tag) => [tagValue(tag), tag]));
    expect(byValue.get("published")).toContain("checked");
    expect(byValue.get("archived")).not.toContain("checked");
    expect(inputs.filter((tag) => tag.includes("checked"))).toHaveLength(1);
  });

  it("selects the archived option when it is the initial value", () => {
    const inputs = inputTags(renderProductGroup("archived"));
    const byValue = new Map(inputs.map((tag) => [tagValue(tag), tag]));
    expect(byValue.get("archived")).toContain("checked");
    expect(byValue.get("published")).not.toContain("checked");
    expect(inputs.filter((tag) => tag.includes("checked"))).toHaveLength(1);
  });

  it("wraps each radio in its card label with a short label and hint", () => {
    const html = renderProductGroup("published");
    expect(html.match(/<label class="aa-radio-card">/g)).toHaveLength(2);
    expect(html).toContain(
      '<span class="aa-radio-card__label">Active</span>',
    );
    expect(html).toContain(
      '<span class="aa-radio-card__hint">Published in the admin panel</span>',
    );
    expect(html).toContain(
      '<span class="aa-radio-card__label">Inactive</span>',
    );
    expect(html).toContain('<span class="aa-radio-card__hint">Archived</span>');
    const publishedCard = html.indexOf('value="published"');
    expect(publishedCard).toBeGreaterThan(
      html.indexOf('<label class="aa-radio-card">'),
    );
    expect(publishedCard).toBeLessThan(html.indexOf(">Active<"));
  });

  it("renders controlled groups with the checked option and labelledby", () => {
    const html = renderToStaticMarkup(
      createElement(RadioOptionGroup, {
        name: "category_level_choice_new",
        ariaLabelledBy: "category-level-label-new",
        options: [
          { value: "primary", label: "Primary", hint: "Top level", checked: false, onChange: () => {} },
          { value: "secondary", label: "Secondary", hint: "Under a primary", checked: true, onChange: () => {} },
        ],
      }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-labelledby="category-level-label-new"');
    const inputs = inputTags(html);
    expect(inputs).toHaveLength(2);
    expect(inputs.map(tagValue).sort()).toEqual(["primary", "secondary"]);
    expect(inputs.filter((tag) => tag.includes("checked"))).toHaveLength(1);
    expect(inputs.find((tag) => tagValue(tag) === "secondary")).toContain("checked");
  });

  it("keeps the shared component stateless and self-contained", () => {
    const component = source(
      "../src/components/admin/catalog/radio-option-cards.tsx",
    );
    expect(component).toContain('type="radio"');
    expect(component).toContain('role="radiogroup"');
    expect(component).toContain("aa-radio-card");
    expect(component).not.toContain("useState");
    expect(component).not.toContain("useEffect");
    expect(component).not.toContain('from "../ui"');
  });
});

describe("radio option card styles", () => {
  const adminPanel = source("../src/app/admin/admin-panel.css");
  const block = adminPanel.slice(
    adminPanel.indexOf("/* Radio option cards"),
    adminPanel.indexOf(".aa-form-actions"),
  );

  it("provides the selected-state styling hooks", () => {
    expect(block).toContain(".aa-radio-card:has(input:checked)");
    expect(block).toContain(".aa-radio-card:has(input:checked) .aa-radio-card__label");
  });

  it("rescues the radio from the generic full-width input sizing", () => {
    expect(block).toContain('input[type="radio"]');
    expect(block).toContain("width: 20px");
    expect(block).toContain("height: 20px");
    expect(block).toContain("accent-color: #6b0202");
  });

  it("keeps a 44px card target with visible focus and a disabled treatment", () => {
    expect(block).toContain("min-height: 44px");
    expect(block).toContain("input:focus-visible");
    expect(block).toContain(".aa-radio-card:has(input:focus-visible)");
    expect(block).toContain(".aa-radio-card:has(input:disabled)");
  });

  it("uses explicit transitions and no hover-only reveal", () => {
    expect(block).toContain("transition: background-color 0.15s");
    expect(block).not.toContain("transition: all");
    expect(block).not.toContain("outline: none");
    expect(block).not.toContain("opacity:");
  });

  it("keeps card text and border contrast above the WCAG floors", () => {
    expect(ratio("#171717", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#6b0202", "#f6eaea")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#5f5a57", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#5f5a57", "#f6eaea")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#5f5a57", "#f7f4f4")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#8f8985", "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(ratio("#6b0202", "#ffffff")).toBeGreaterThanOrEqual(3);
  });
});

describe("visibility wiring", () => {
  it("keeps the honest storefront note in both places in the product form", () => {
    const form = source("../src/components/admin/catalog/product-form.tsx");
    expect(form).toContain(
      "Published products are visible but cannot be ordered yet.",
    );
    expect(form.match(/\{STOREFRONT_NOTE\}/g)).toHaveLength(2);
    const slice = form.slice(
      form.indexOf('title="Visibility"'),
      form.indexOf("</fieldset>", form.indexOf('title="Visibility"')),
    );
    expect(slice).toContain("RadioOptionGroup");
    expect(slice).toContain('name="status"');
    expect(slice).toContain("{STOREFRONT_NOTE}");
    expect(slice).toContain('describedBy("status", "product-status")');
    expect(slice).not.toContain('type="radio"');
    expect(slice).not.toContain("aa-check-row");
    expect(form).toContain('from "./radio-option-cards"');
  });

  it("uses the same control for the category level group", () => {
    const form = source("../src/components/admin/catalog/category-form.tsx");
    const slice = form.slice(
      form.indexOf('inputId("level-label")'),
      form.indexOf('htmlFor={inputId("parent")}'),
    );
    expect(slice).toContain("RadioOptionGroup");
    expect(slice).toContain("category_level_choice_");
    expect(slice).toContain('name="category_level"');
    expect(slice).toContain('value: "sub"');
    expect(slice).toContain("isCreate");
    expect(slice).not.toContain("aa-check-row");
    expect(slice).not.toContain('type="radio"');
    expect(form).toContain('from "./radio-option-cards"');
  });
});
