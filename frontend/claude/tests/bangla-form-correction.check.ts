import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AREA_BN, AREAS, DISTRICT_BN, DIVISION_BN, DIVISIONS, areaLabel, areasOf, districtLabel, districtsOf, divisionLabel, divisionNames } from "../src/data/bangladesh";
import { Select } from "../src/components/ui";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const checkoutForm = read("../src/components/checkout/CheckoutForm.tsx");
const addressManager = read("../src/components/account/AddressManager.tsx");

const BANGLA = /[\u0980-\u09ff]/;

describe("Bangla display-name dataset", () => {
  it("covers all 8 divisions, 64 districts and 560 areas with no gaps", () => {
    expect(Object.keys(DIVISION_BN)).toHaveLength(8);
    expect(Object.keys(DISTRICT_BN)).toHaveLength(64);
    expect(Object.keys(AREA_BN)).toHaveLength(64);
    expect(Object.values(AREA_BN).flatMap((areas) => Object.keys(areas))).toHaveLength(560);
  });

  it("mirrors the English tables key for key", () => {
    expect(Object.keys(DIVISION_BN).sort()).toEqual(divisionNames.slice().sort());
    const districts = Object.values(DIVISIONS).flat();
    expect(Object.keys(DISTRICT_BN).sort()).toEqual(districts.slice().sort());
    for (const district of districts) {
      expect(Object.keys(AREA_BN[district] ?? {}).sort()).toEqual(areasOf(district).slice().sort());
    }
  });

  it("gives every key exactly one non-empty Bangla name", () => {
    for (const [name, bn] of [...Object.entries(DIVISION_BN), ...Object.entries(DISTRICT_BN)]) {
      expect(bn.length).toBeGreaterThan(0);
      expect(bn).toMatch(BANGLA);
      expect(bn).not.toContain("(");
      // No edge whitespace or control characters (a stray tab once hid
      // here and rendered inside the brackets).
      expect(bn).toBe(bn.trim());
      expect(bn).not.toMatch(/[\u0000-\u001f\u007f]/);
      expect(name).not.toBe(bn);
    }
    for (const [district, areas] of Object.entries(AREA_BN)) {
      for (const [area, bn] of Object.entries(areas)) {
        expect(bn.length, `${district}/${area}`).toBeGreaterThan(0);
        expect(bn, `${district}/${area}`).toMatch(BANGLA);
        expect(bn, `${district}/${area}`).not.toContain("(");
        expect(bn, `${district}/${area}`).toBe(bn.trim());
        expect(bn, `${district}/${area}`).not.toMatch(/[\u0000-\u001f\u007f]/);
      }
      // No two areas in a district share a Bangla name.
      expect(new Set(Object.values(areas)).size).toBe(Object.keys(areas).length);
    }
  });

  it("renders the owner's examples exactly", () => {
    expect(divisionLabel("Sylhet")).toBe("Sylhet (সিলেট)");
    expect(districtLabel("Habiganj")).toBe("Habiganj (হবিগঞ্জ)");
    expect(areaLabel("Habiganj", "Habiganj Sadar")).toBe("Habiganj Sadar (হবিগঞ্জ সদর)");
    expect(divisionLabel("Dhaka")).toBe("Dhaka (ঢাকা)");
    expect(divisionLabel("Chattogram")).toBe("Chattogram (চট্টগ্রাম)");
    expect(areaLabel("Sylhet", "Sylhet Sadar")).toBe("Sylhet Sadar (সিলেট সদর)");
  });

  it("formats every label as 'English (Bangla)'", () => {
    for (const division of divisionNames) {
      expect(divisionLabel(division)).toMatch(new RegExp(`^${division.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(.+\\)$`));
    }
    for (const district of Object.values(DIVISIONS).flat()) {
      expect(districtLabel(district)).toMatch(new RegExp(`^${district.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(.+\\)$`));
      for (const area of areasOf(district)) {
        expect(areaLabel(district, area)).toMatch(new RegExp(`^${area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(.+\\)$`));
      }
    }
  });

  it("falls back to the English name alone when a Bangla name is missing", () => {
    expect(divisionLabel("No such division")).toBe("No such division");
    expect(districtLabel("No such district")).toBe("No such district");
    expect(areaLabel("Dhaka", "No such area")).toBe("No such area");
    expect(areaLabel("No such district", "Anything")).toBe("Anything");
  });

  it("leaves the English submitted values untouched", () => {
    expect(districtsOf("Sylhet")).toEqual(["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"]);
    expect(areasOf("Habiganj")).toContain("Habiganj Sadar");
    expect(Object.values(AREAS).flat().length).toBe(560);
  });
});

describe("bilingual select rendering", () => {
  // React escapes apostrophes in markup; normalize so Cox's Bazar matches.
  const renderOptions = (options: { value: string; label: string }[]) =>
    renderToStaticMarkup(createElement(Select, { id: "probe", label: "Probe", options, value: "", onChange: () => {} })).replaceAll("&#x27;", "'");

  it("renders every division option with an English value and a bilingual label", () => {
    const html = renderOptions(divisionNames.map((d) => ({ value: d, label: divisionLabel(d) })));
    for (const d of divisionNames) {
      expect(html).toContain(`<option value="${d}">${divisionLabel(d)}</option>`);
    }
  });

  it("renders every district option with an English value and a bilingual label", () => {
    const districts = Object.values(DIVISIONS).flat();
    const html = renderOptions(districts.map((d) => ({ value: d, label: districtLabel(d) })));
    for (const d of districts) {
      expect(html).toContain(`<option value="${d}">${districtLabel(d)}</option>`);
    }
  });

  it("renders every area option with an English value and a bilingual label", () => {
    for (const district of Object.values(DIVISIONS).flat()) {
      const html = renderOptions(areasOf(district).map((a) => ({ value: a, label: areaLabel(district, a) })));
      for (const a of areasOf(district)) {
        expect(html).toContain(`<option value="${a}">${areaLabel(district, a)}</option>`);
      }
    }
  });
});

describe("checkout form wiring", () => {
  it("builds the three selects from the label helpers with English values", () => {
    expect(checkoutForm).toContain("options={divisionNames.map((d) => ({ value: d, label: divisionLabel(d) }))}");
    expect(checkoutForm).toContain("options={districts.map((d) => ({ value: d, label: districtLabel(d) }))}");
    expect(checkoutForm).toContain("options={areas.map((a) => ({ value: a, label: areaLabel(form.district, a) }))}");
    expect(checkoutForm).toContain('import { areaLabel, areasOf, districtLabel, districtsOf, divisionLabel, divisionNames, isInsideBarishalCity } from "@/data/bangladesh"');
  });

  it("keeps the heading and labels English, placeholders/hints/errors Bangla", () => {
    // Final owner spec: "Your name" label with "আপনার নাম লিখুন" inside
    // the input. Labels use the label="..." form because the Bangla
    // placeholders and errors contain the same words as bare substrings.
    for (const text of [
      ">Delivery Information</h2>",
      'label="Your name"',
      'label="Mobile number"',
      'label="Email (optional)"',
      'label="Division"',
      'label="District"',
      'label="Area / Upazila"',
      'label="Detailed address"',
      'placeholder="আপনার নাম লিখুন"',
      'placeholder="বিভাগ নির্বাচন করুন"',
      'hint="অর্ডার নিশ্চিত করতে আমরা কল করব।"',
      "আপনার পুরো নাম লিখুন",
      "Back to cart",
      "Continue to Payment",
    ]) {
      expect(checkoutForm).toContain(text);
    }
    for (const text of [
      "ডেলিভারি তথ্য",
      'label="পুরো নাম"',
      'label="মোবাইল নম্বর"',
      'label="ইমেইল (ঐচ্ছিক)"',
      'label="বিভাগ"',
      'label="জেলা"',
      'label="এলাকা / উপজেলা"',
      'label="বিস্তারিত ঠিকানা"',
      "কার্টে ফিরুন",
      "পেমেন্টে এগিয়ে যান",
      "পরের বার ব্যবহারের জন্য এই ঠিকানাটি সংরক্ষণ করুন",
    ]) {
      expect(checkoutForm).not.toContain(text);
    }
    expect(checkoutForm).toContain('lang="bn"');
  });

  it("keeps everything outside the delivery form in English", () => {
    for (const text of ["Inside Barishal City", "Outside Barishal City", "Select a district to calculate delivery", 'label="Order note (optional)"', "Anything we should know? e.g. preferred delivery time"]) {
      expect(checkoutForm).toContain(text);
    }
    for (const text of ["ঢাকার ভিতরে", "ঢাকার বাইরে", "ডেলিভারি চার্জ জানতে জেলা বেছে নিন", "অর্ডার নোট"]) {
      expect(checkoutForm).not.toContain(text);
    }
    // lang="bn" appears twice: the delivery form element itself, and the
    // order-placed screen, whose Bangla confirmation the owner requested
    // 2026-11-19. The review card and the order note carry none.
    expect(checkoutForm.match(/lang="bn"/g)).toHaveLength(2);
    expect(checkoutForm).toContain("আপনার অর্ডারটি গ্রহণ করা হয়েছে");
  });

  it("does not touch the ordering gate or the checkout notice", () => {
    expect(checkoutForm).toContain("canPlaceOrder(orderingEnabled, manualPaymentConfiguration.available)");
    expect(checkoutForm).toContain("Ordering and payment collection are currently unavailable");
    // Owner 2026-11-20 removed the payment-step "Continue shopping" button;
    // Submit Payment places the order. The placed-order link stays.
    expect(checkoutForm).toContain('>Continue Shopping</ButtonLink>');
  });
});

describe("untouched surfaces", () => {
  it("leaves the account address manager English-only", () => {
    expect(addressManager).not.toContain("divisionLabel");
    expect(addressManager).not.toContain("districtLabel");
    expect(addressManager).not.toContain("areaLabel");
    expect(addressManager).toContain('options={divisionNames.map((d) => ({ value: d, label: d }))}');
  });
});
