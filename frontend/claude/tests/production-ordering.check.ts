import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

const checkoutForm = read("../src/components/checkout/CheckoutForm.tsx");
const checkoutPage = read("../src/app/(store)/checkout/page.tsx");

describe("production ordering notice", () => {
  it("branches the checkout notice on the production storefront, not only on orderingEnabled", () => {
    expect(checkoutForm).toContain("isProduction");
    expect(checkoutForm).toContain("checkoutNotice");
    // Branch placement, in ternary order: production+enabled renders
    // nothing, production+disabled renders the plain copy, and only the
    // non-production branches carry the staging label and Preview wording.
    // A swapped branch would keep every string present yet fail this order.
    const noticeIdx = checkoutForm.indexOf("const checkoutNotice = isProduction");
    const nullIdx = checkoutForm.indexOf("? null", noticeIdx);
    const plainIdx = checkoutForm.indexOf('do not send money or enter real payment details."', noticeIdx);
    const stagingIdx = checkoutForm.indexOf("This is a Staging test store", noticeIdx);
    const previewIdx = checkoutForm.indexOf("in this Preview", noticeIdx);
    expect(noticeIdx).toBeGreaterThan(-1);
    expect(nullIdx).toBeGreaterThan(noticeIdx);
    expect(plainIdx).toBeGreaterThan(nullIdx);
    expect(stagingIdx).toBeGreaterThan(plainIdx);
    expect(previewIdx).toBeGreaterThan(stagingIdx);
  });

  it("keeps the staging test-store copy for non-production checkouts", () => {
    expect(checkoutForm).toContain("This is a Staging test store. Orders placed here are test orders");
  });

  it("never shows the Preview wording on a production checkout", () => {
    // The only "in this Preview" occurrence must sit in the non-production
    // branch: the production disabled copy drops it.
    const previewOccurrences = checkoutForm.split("in this Preview").length - 1;
    expect(previewOccurrences).toBe(1);
    expect(checkoutForm).toContain(
      "Ordering and payment collection are currently unavailable. Totals are estimates; do not send money or enter real payment details.\"",
    );
  });

  it("renders the notice only when there is notice text", () => {
    expect(checkoutForm).toContain("{checkoutNotice && (");
    expect(checkoutForm).toContain("<DemoNotice force className=\"mb-5\">");
    expect(checkoutForm).toContain("{checkoutNotice}");
  });
});

describe("production ordering page wiring", () => {
  it("passes the production storefront state into the checkout form", () => {
    expect(checkoutPage).toContain("isProductionStorefront");
    expect(checkoutPage).toContain("isProduction={isProductionStorefront()}");
    expect(checkoutPage).toContain("orderingEnabled={checkoutOrdersEnabled()}");
  });
});
