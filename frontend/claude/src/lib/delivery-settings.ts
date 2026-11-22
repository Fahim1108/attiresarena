import { ALL_DISTRICTS, isDistrict } from "@/data/bangladesh";
import type { CommerceSettings } from "@/types";

/**
 * Admin-editable delivery zones (Fahim, voice 2026-11-22): the admin picks
 * ANY of Bangladesh's 64 districts as the "Inside" zone and edits both
 * charges. The values live in public.store_settings
 * (delivery_inside_district / delivery_inside_charge_minor /
 * delivery_outside_charge_minor, migration 20261122000100) and are mirrored
 * into private.checkout_settings by a DB trigger, so the storefront
 * display, the checkout estimate, the advance amount and the
 * server-charged amount all read the same saved values.
 *
 * This module is pure (no "server-only"): the payment config, the cart
 * context and the store-settings reader all import it.
 *
 * "Inside" means the WHOLE selected district — every upazila of it pays
 * the inside charge. (Before this change, inside meant only Barishal
 * Sadar upazila of Barishal district.)
 */

export interface DeliverySettings {
  /** The district that pays the inside charge. */
  insideDistrict: string;
  /** Inside charge in minor units (100 minor = ৳1). */
  insideChargeMinor: number;
  /** Outside charge in minor units. */
  outsideChargeMinor: number;
}

/** Today's values: Inside Barishal ৳50, Outside ৳140. */
export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  insideDistrict: "Barishal",
  insideChargeMinor: 5000,
  outsideChargeMinor: 14000,
};

/** Charges are whole-taka amounts up to ৳10,000 (1,000,000 minor). */
export const MAX_DELIVERY_CHARGE_MINOR = 1000000;

function parseChargeMinor(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return fallback;
  if (value < 0 || value > MAX_DELIVERY_CHARGE_MINOR) return fallback;
  return value;
}

/**
 * Parse the three delivery keys out of a store_settings map. Each field
 * falls back to its default independently, so one bad value never
 * disables the others, and an empty/missing map yields the defaults —
 * the storefront renders exactly as before until the admin saves.
 */
export function parseDeliverySettings(
  settings: Record<string, unknown> | null | undefined,
): DeliverySettings {
  const district = settings?.["delivery_inside_district"];
  return {
    insideDistrict:
      typeof district === "string" && isDistrict(district.trim())
        ? district.trim()
        : DEFAULT_DELIVERY_SETTINGS.insideDistrict,
    insideChargeMinor: parseChargeMinor(
      settings?.["delivery_inside_charge_minor"],
      DEFAULT_DELIVERY_SETTINGS.insideChargeMinor,
    ),
    outsideChargeMinor: parseChargeMinor(
      settings?.["delivery_outside_charge_minor"],
      DEFAULT_DELIVERY_SETTINGS.outsideChargeMinor,
    ),
  };
}

export function resolveDeliverySettings(
  settings: Record<string, unknown> | null | undefined,
): DeliverySettings {
  return parseDeliverySettings(settings);
}

/** Whole-taka formatting for a minor-units charge (৳50, ৳140, ৳1,500). */
export function formatChargeTaka(chargeMinor: number): string {
  return `৳${new Intl.NumberFormat("en-BD").format(chargeMinor / 100)}`;
}

/**
 * Announcement-bar text for the saved zones, in the owner's exact format:
 * "Nationwide delivery: ৳50 inside Barishal · ৳140 outside".
 */
export function deliveryAnnouncementText(delivery: DeliverySettings): string {
  return `Nationwide delivery: ${formatChargeTaka(delivery.insideChargeMinor)} inside ${delivery.insideDistrict} · ${formatChargeTaka(delivery.outsideChargeMinor)} outside`;
}

/**
 * Commerce override: the saved district + charges replace the static
 * config. Returns the static commerce unchanged (same reference) when
 * the saved values equal the defaults, so nothing re-renders needlessly.
 */
export function applyDeliveryOverride(
  commerce: CommerceSettings,
  settings: Record<string, unknown> | null | undefined,
): CommerceSettings {
  const delivery = parseDeliverySettings(settings);
  if (
    delivery.insideDistrict === commerce.deliveryInsideDistrict &&
    delivery.insideChargeMinor === commerce.deliveryCharges.inside * 100 &&
    delivery.outsideChargeMinor === commerce.deliveryCharges.outside * 100
  ) {
    return commerce;
  }
  return {
    ...commerce,
    deliveryInsideDistrict: delivery.insideDistrict,
    deliveryCharges: {
      inside: delivery.insideChargeMinor / 100,
      outside: delivery.outsideChargeMinor / 100,
    },
  };
}
