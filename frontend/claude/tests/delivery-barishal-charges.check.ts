import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { commerce, defaultStorefrontSettings } from "../src/config";
import { footer } from "../src/config/footer";
import { header } from "../src/config/header";
import { AnnouncementBar } from "../src/components/layout/AnnouncementBar";
import { Footer } from "../src/components/layout/Footer";
import { ManualAdvancePayment } from "../src/components/checkout/ManualAdvancePayment";
import { ProductDeliveryInfo } from "../src/components/product/ProductDeliveryInfo";
import { StorefrontProvider } from "../src/context/StorefrontContext";
import { deliveryZone, isInsideBarishalCity } from "../src/data/bangladesh";
import { advanceBreakdown, manualPaymentBreakdown } from "../src/lib/manual-payment";
import { previewPaymentConfiguration } from "../src/config/payment-receiving";
import type { ManualPaymentConfiguration } from "../src/types/manual-payment";

const policy = previewPaymentConfiguration().policy;

describe("Barishal City delivery zone", () => {
  it("is inside only for Barishal Sadar upazila of Barishal district", () => {
    expect(isInsideBarishalCity("Barishal", "Barishal", "Barishal Sadar")).toBe(true);
    expect(deliveryZone("Barishal", "Barishal", "Barishal Sadar")).toBe("inside-barishal-city");
  });

  it("is outside for the rest of Barishal division", () => {
    for (const [district, area] of [
      ["Barishal", "Babuganj"],
      ["Barishal", "Bakerganj"],
      ["Barguna", "Barguna Sadar"],
      ["Bhola", "Bhola Sadar"],
      ["Jhalokati", "Jhalokati Sadar"],
      ["Patuakhali", "Patuakhali Sadar"],
      ["Pirojpur", "Pirojpur Sadar"],
    ] as const) {
      expect(isInsideBarishalCity("Barishal", district, area)).toBe(false);
      expect(deliveryZone("Barishal", district, area)).toBe("outside-barishal-city");
    }
  });

  it("is outside for Dhaka and every other division", () => {
    for (const [division, district, area] of [
      ["Dhaka", "Dhaka", "Mirpur"],
      ["Dhaka", "Gazipur", "Gazipur Sadar"],
      ["Chattogram", "Cumilla", "Cumilla Adarsha Sadar"],
      ["Sylhet", "Sylhet", "Sylhet Sadar"],
      ["Khulna", "Khulna", "Sonadanga"],
      ["Rajshahi", "Rajshahi", "Paba"],
      ["Rangpur", "Rangpur", "Rangpur Sadar"],
      ["Mymensingh", "Mymensingh", "Mymensingh Sadar"],
    ] as const) {
      expect(isInsideBarishalCity(division, district, area)).toBe(false);
      expect(deliveryZone(division, district, area)).toBe("outside-barishal-city");
    }
  });

  it("is outside when the address is incomplete or invented", () => {
    expect(isInsideBarishalCity("", "", "")).toBe(false);
    expect(isInsideBarishalCity("Barishal", "Barishal", "")).toBe(false);
    expect(isInsideBarishalCity("Barishal", "Barishal", "Not an area")).toBe(false);
    expect(isInsideBarishalCity("Sylhet", "Barishal", "Barishal Sadar")).toBe(false);
  });
});

describe("Barishal delivery charges (no free delivery)", () => {
  it("charges 50 inside Barishal City and 140 everywhere else", () => {
    expect(commerce.deliveryCharges).toEqual({ insideBarishalCity: 50, outsideBarishalCity: 140 });
    expect("freeDeliveryThreshold" in commerce).toBe(false);
  });

  it("announcement bar carries no free-delivery promise", () => {
    expect(header.announcement.left).not.toMatch(/free/i);
    expect(header.announcement.left).not.toContain("2,000");
    expect(header.announcement.left).toContain("৳50");
    expect(header.announcement.left).toContain("৳140");
  });

  it("footer address is Barishal, not Dhaka", () => {
    expect(footer.contact.address).toBe("Barishal, Bangladesh");
  });

  it("advances exactly the delivery charge — 50 inside, 140 outside — at any order size", () => {
    // No free-delivery waiver: even a large order still pays the charge.
    expect(advanceBreakdown(500000, "Barishal", "Barishal", "Barishal Sadar", policy)).toEqual({
      zone: "inside-barishal-city", totalMinor: 500000, advanceMinor: 5000, remainingMinor: 495000,
    });
    expect(advanceBreakdown(500000, "Dhaka", "Dhaka", "Mirpur", policy)).toEqual({
      zone: "outside-barishal-city", totalMinor: 500000, advanceMinor: 14000, remainingMinor: 486000,
    });
    expect(manualPaymentBreakdown("cod", 500000, "Barishal", "Barguna", "Barguna Sadar", policy)).toMatchObject({
      amountDueMinor: 14000, remainingMinor: 486000,
    });
  });

  it("shows the Barishal zone and advance in the payment panel", () => {
    const configuration: ManualPaymentConfiguration = {
      available: true,
      policy,
      destinations: [{ provider: "bkash", recipientNumber: "configured-in-test", accountType: "personal", transferInstructions: "" }],
    };
    const city = renderToStaticMarkup(createElement(ManualAdvancePayment, {
      mode: "cod", configuration, totalMinor: 200000, division: "Barishal", district: "Barishal", area: "Barishal Sadar",
    }));
    expect(city).toContain("Inside Barishal City");
    expect(city).toContain("৳50");
    expect(city).not.toContain("Dhaka");
    const outside = renderToStaticMarkup(createElement(ManualAdvancePayment, {
      mode: "cod", configuration, totalMinor: 200000, division: "Dhaka", district: "Dhaka", area: "Mirpur",
    }));
    expect(outside).toContain("Outside Barishal City");
    expect(outside).toContain("৳140");
  });
});

describe("Barishal delivery fixes (Preview 2026-11-21)", () => {
  it("delivery card shows the Barishal charges on every product page", () => {
    // The card is a standalone component now, rendered unconditionally by
    // the product page — it must not depend on the product being real vs a
    // design-review fixture.
    const card = renderToStaticMarkup(createElement(ProductDeliveryInfo, {}));
    expect(card).toContain("Delivery Information");
    expect(card).toContain("Inside Barishal City");
    expect(card).toContain("BDT 50");
    expect(card).toContain("1–2 working days");
    expect(card).toContain("Outside Barishal City");
    expect(card).toContain("BDT 140");
    expect(card).toContain("2–3 working days");
    expect(card).toContain("Order confirmation");
    expect(card).not.toMatch(/Dhaka|free delivery/i);
  });

  it("announcement bar renders the full delivery message without truncation", () => {
    const bar = renderToStaticMarkup(
      createElement(
        StorefrontProvider,
        { settings: defaultStorefrontSettings } as { settings: typeof defaultStorefrontSettings; children: ReactNode },
        createElement(AnnouncementBar, {}),
      ),
    );
    // Full message present, not cut off mid-word at the "…৳140 outside" end.
    expect(bar).toContain("Nationwide delivery: ৳50 inside Barishal City · ৳140 outside");
    // No truncation anywhere in the bar: no `truncate` class on any line.
    expect(bar).not.toContain("truncate");
    expect(bar).not.toMatch(/free/i);
  });

  it("announcement default left text is exactly the Barishal message", () => {
    // The code default (src/config/header.ts) is the intended bar text.
    // A stale stored `announcement_bar` DB override replaces it at runtime
    // (applyAnnouncementOverride) — that value must be fixed in the DB, not
    // here: on the 2026-11-21 Preview the bar showed a stale fragment
    // ("out of delivery") from the stored override, not this default.
    expect(header.announcement.left).toBe(
      "Nationwide delivery: ৳50 inside Barishal City · ৳140 outside",
    );
  });

  it("footer renders the Barishal address line", () => {
    // Regression (Preview 2026-11-21): the footer showed no address at all
    // — Footer.tsx never rendered footer.contact, so the ae73a87 config
    // change (Dhaka -> Barishal) was invisible. Only the address renders;
    // phone/email stay placeholder values in the config and must not show.
    const html = renderToStaticMarkup(
      createElement(
        StorefrontProvider,
        { settings: defaultStorefrontSettings } as { settings: typeof defaultStorefrontSettings; children: ReactNode },
        createElement(Footer, {}),
      ),
    );
    expect(html).toContain("Barishal, Bangladesh");
    expect(html).not.toContain("Dhaka");
    expect(html).not.toContain("1XXX");
  });
});
