import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_DISTRICTS, deliveryZone, isDistrict, isInsideDeliveryZone } from "../src/data/bangladesh";
import {
  DEFAULT_DELIVERY_SETTINGS,
  applyDeliveryOverride,
  deliveryAnnouncementText,
  formatChargeTaka,
  parseDeliverySettings,
} from "../src/lib/delivery-settings";
import { DELIVERY_SETTINGS_SCHEMA, deliveryDistrictOptions, settingNumber } from "../src/lib/admin/settings-shared";
import { advanceBreakdown } from "../src/lib/manual-payment";
import { previewPaymentConfiguration } from "../src/config/payment-receiving";
import { commerce } from "../src/config";
import { ProductDeliveryInfo } from "../src/components/product/ProductDeliveryInfo";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationPath = join(
  repoRoot,
  "supabase/migrations/20261122000100_delivery_zone_settings.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("delivery settings parsing", () => {
  it("defaults to Inside Barishal ৳50 / Outside ৳140 with no stored values", () => {
    expect(DEFAULT_DELIVERY_SETTINGS).toEqual({
      insideDistrict: "Barishal",
      insideChargeMinor: 5000,
      outsideChargeMinor: 14000,
    });
    expect(parseDeliverySettings(null)).toEqual(DEFAULT_DELIVERY_SETTINGS);
    expect(parseDeliverySettings({})).toEqual(DEFAULT_DELIVERY_SETTINGS);
  });

  it("reads the saved district and charges", () => {
    expect(
      parseDeliverySettings({
        delivery_inside_district: "Dhaka",
        delivery_inside_charge_minor: 7000,
        delivery_outside_charge_minor: 15000,
      }),
    ).toEqual({ insideDistrict: "Dhaka", insideChargeMinor: 7000, outsideChargeMinor: 15000 });
  });

  it("falls back per field on bad values, never disabling the rest", () => {
    expect(
      parseDeliverySettings({
        delivery_inside_district: "Not a district",
        delivery_inside_charge_minor: -5,
        delivery_outside_charge_minor: "14000",
      }),
    ).toEqual({ insideDistrict: "Barishal", insideChargeMinor: 5000, outsideChargeMinor: 14000 });
    expect(
      parseDeliverySettings({ delivery_inside_district: "Khulna" }),
    ).toEqual({ insideDistrict: "Khulna", insideChargeMinor: 5000, outsideChargeMinor: 14000 });
  });

  it("covers all 64 districts as one flat, uniformly-aligned option list", () => {
    expect(ALL_DISTRICTS).toHaveLength(64);
    for (const district of ["Barishal", "Dhaka", "Khulna", "Rajshahi", "Chattogram", "Sylhet", "Rangpur", "Mymensingh"]) {
      expect(isDistrict(district)).toBe(true);
    }
    expect(isDistrict("Not a district")).toBe(false);
    // Flat list, not optgroups: every row renders the same in the native
    // select, and no division name ever appears as a row of its own
    // (division names double as district names, e.g. Rangpur).
    const options = deliveryDistrictOptions();
    expect(options).toHaveLength(64);
    expect(options.map((o) => o.value).sort()).toEqual([...ALL_DISTRICTS].sort());
    // English names match the official 64-district list exactly.
    expect([...ALL_DISTRICTS].sort()).toEqual(
      [
        "Bagerhat", "Bandarban", "Barguna", "Barishal", "Bhola", "Bogura",
        "Brahmanbaria", "Chandpur", "Chapai Nawabganj", "Chattogram",
        "Chuadanga", "Cox's Bazar", "Cumilla", "Dhaka", "Dinajpur",
        "Faridpur", "Feni", "Gaibandha", "Gazipur", "Gopalganj", "Habiganj",
        "Jamalpur", "Jashore", "Jhalokati", "Jhenaidah", "Joypurhat",
        "Khagrachhari", "Khulna", "Kishoreganj", "Kurigram", "Kushtia",
        "Lakshmipur", "Lalmonirhat", "Madaripur", "Magura", "Manikganj",
        "Meherpur", "Moulvibazar", "Munshiganj", "Mymensingh", "Naogaon",
        "Narail", "Narayanganj", "Narsingdi", "Natore", "Netrokona",
        "Nilphamari", "Noakhali", "Pabna", "Panchagarh", "Patuakhali",
        "Pirojpur", "Rajbari", "Rajshahi", "Rangamati", "Rangpur",
        "Satkhira", "Shariatpur", "Sherpur", "Sirajganj", "Sunamganj",
        "Sylhet", "Tangail", "Thakurgaon",
      ].sort(),
    );
    for (const option of options) {
      expect(option.label).toContain(" — ");
      expect(option.label.startsWith(`${option.value} (`)).toBe(true);
    }
    expect(deliveryDistrictOptions().find((o) => o.value === "Dinajpur")?.label).toBe(
      "Dinajpur (দিনাজপুর) — Rangpur (রংপুর)",
    );
    expect(deliveryDistrictOptions().find((o) => o.value === "Barishal")?.label).toBe(
      "Barishal (বরিশাল) — Barishal (বরিশাল)",
    );
  });

  it("formats the announcement text from the saved zones", () => {
    expect(deliveryAnnouncementText(DEFAULT_DELIVERY_SETTINGS)).toBe(
      "Nationwide delivery: ৳50 inside Barishal · ৳140 outside",
    );
    expect(
      deliveryAnnouncementText({ insideDistrict: "Dhaka", insideChargeMinor: 7000, outsideChargeMinor: 15000 }),
    ).toBe("Nationwide delivery: ৳70 inside Dhaka · ৳150 outside");
    expect(formatChargeTaka(5000)).toBe("৳50");
    expect(formatChargeTaka(15000)).toBe("৳150");
  });

  it("overrides the static commerce charges with the saved ones", () => {
    const overridden = applyDeliveryOverride(commerce, {
      delivery_inside_district: "Dhaka",
      delivery_inside_charge_minor: 7000,
      delivery_outside_charge_minor: 15000,
    });
    expect(overridden.deliveryInsideDistrict).toBe("Dhaka");
    expect(overridden.deliveryCharges).toEqual({ inside: 70, outside: 150 });
    // Defaults return the same reference: nothing re-renders needlessly.
    expect(applyDeliveryOverride(commerce, {})).toBe(commerce);
    expect(applyDeliveryOverride(commerce, null)).toBe(commerce);
  });
});

describe("district zone follows the saved inside district", () => {
  it("treats the whole selected district as inside", () => {
    expect(isInsideDeliveryZone("Dhaka", "Dhaka")).toBe(true);
    expect(deliveryZone("Dhaka", "Dhaka")).toBe("inside");
    expect(isInsideDeliveryZone("Barishal", "Dhaka")).toBe(false);
    expect(deliveryZone("Khulna", "Dhaka")).toBe("outside");
  });

  it("advances the saved charges for the selected district", () => {
    const dhakaPolicy = previewPaymentConfiguration(undefined, {
      insideDistrict: "Dhaka",
      insideChargeMinor: 7000,
      outsideChargeMinor: 15000,
    }).policy;
    expect(dhakaPolicy).toEqual({
      insideMinor: 7000,
      outsideMinor: 15000,
      insideDistrict: "Dhaka",
      credit: "against-order-total",
    });
    expect(advanceBreakdown(200000, "Dhaka", "Dhaka", "Mirpur", dhakaPolicy)).toEqual({
      zone: "inside",
      totalMinor: 200000,
      advanceMinor: 7000,
      remainingMinor: 193000,
    });
    expect(advanceBreakdown(200000, "Barishal", "Barishal", "Barishal Sadar", dhakaPolicy)).toEqual({
      zone: "outside",
      totalMinor: 200000,
      advanceMinor: 15000,
      remainingMinor: 185000,
    });
  });

  it("renders the saved district and charges on the product delivery card", () => {
    const card = renderToStaticMarkup(
      createElement(ProductDeliveryInfo, {
        delivery: { insideDistrict: "Dhaka", insideChargeMinor: 7000, outsideChargeMinor: 15000 },
      }),
    );
    expect(card).toContain("Inside Dhaka");
    expect(card).toContain("BDT 70");
    expect(card).toContain("Outside Dhaka");
    expect(card).toContain("BDT 150");
    expect(card).not.toContain("Barishal");
  });
});

describe("delivery settings form validation", () => {
  it("accepts any of the 64 districts with whole-taka charges", () => {
    expect(
      DELIVERY_SETTINGS_SCHEMA.safeParse({
        delivery_inside_district: "Rajshahi",
        delivery_inside_charge_taka: 60,
        delivery_outside_charge_taka: 130,
      }).success,
    ).toBe(true);
  });

  it("rejects invented districts and out-of-range charges", () => {
    for (const value of [
      { delivery_inside_district: "Not a district", delivery_inside_charge_taka: 50, delivery_outside_charge_taka: 140 },
      { delivery_inside_district: "Dhaka", delivery_inside_charge_taka: -1, delivery_outside_charge_taka: 140 },
      { delivery_inside_district: "Dhaka", delivery_inside_charge_taka: 50.5, delivery_outside_charge_taka: 140 },
      { delivery_inside_district: "Dhaka", delivery_inside_charge_taka: 50, delivery_outside_charge_taka: 10001 },
    ]) {
      expect(DELIVERY_SETTINGS_SCHEMA.safeParse(value).success).toBe(false);
    }
  });

  it("reads stored charge values as integers for the form", () => {
    expect(settingNumber({ delivery_inside_charge_minor: 5000 }, "delivery_inside_charge_minor")).toBe(5000);
    expect(settingNumber({ delivery_inside_charge_minor: "5000" }, "delivery_inside_charge_minor")).toBe(null);
    expect(settingNumber({}, "delivery_inside_charge_minor")).toBe(null);
  });
});

describe("migration 20261122000100 text", () => {
  it("exists and runs as one transaction", () => {
    expect(migration.trimStart().startsWith("begin;")).toBe(true);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("generalizes the checkout settings columns and adds the inside district", () => {
    expect(migration).toContain(
      "rename column delivery_inside_barishal_city_minor to delivery_inside_minor",
    );
    expect(migration).toContain(
      "rename column delivery_outside_barishal_city_minor to delivery_outside_minor",
    );
    expect(migration).toContain(
      "add column delivery_inside_district text not null default 'Barishal'",
    );
  });

  it("lifts the repeat-order caps to the column maximum", () => {
    expect(migration).toContain("orders_per_phone_per_day = 100000");
    expect(migration).toContain("orders_per_client_per_hour = 100000");
  });

  it("mirrors store_settings into checkout_settings with a trigger", () => {
    expect(migration).toContain("private.sync_delivery_settings_from_store()");
    expect(migration).toContain("store_settings_delivery_sync");
    expect(migration).toContain("after insert or update of value on public.store_settings");
  });

  it("seeds the delivery keys with today's Barishal values", () => {
    expect(migration).toContain("('delivery_inside_district', '\"Barishal\"', null)");
    expect(migration).toContain("('delivery_inside_charge_minor', '5000', null)");
    expect(migration).toContain("('delivery_outside_charge_minor', '14000', null)");
  });

  it("allowlists the delivery keys for public reads and admin writes", () => {
    expect(migration).toContain(
      "'delivery_inside_district','delivery_inside_charge_minor','delivery_outside_charge_minor'",
    );
    expect(migration).toContain("elsif p_key = 'delivery_inside_district' then");
    expect(migration).toContain("elsif p_key in ('delivery_inside_charge_minor','delivery_outside_charge_minor') then");
  });

  it("redefines place_checkout_order on the district rule with no old column references", () => {
    expect(migration).toContain("create or replace function public.place_checkout_order");
    expect(migration).toContain(
      "when v_district = cfg.delivery_inside_district then cfg.delivery_inside_minor",
    );
    expect(migration).toContain("else cfg.delivery_outside_minor end;");
    // The old Barishal columns survive only in the header comment and the
    // two rename statements — never inside a function body.
    const bodies = migration.split("create or replace function");
    for (const body of bodies.slice(1)) {
      expect(body).not.toContain("delivery_inside_barishal_city_minor");
      expect(body).not.toContain("delivery_outside_barishal_city_minor");
    }
  });

  it("is the newest migration file", () => {
    const files = readdirSync(join(repoRoot, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files[files.length - 1]).toBe("20261122000100_delivery_zone_settings.sql");
  });
});
