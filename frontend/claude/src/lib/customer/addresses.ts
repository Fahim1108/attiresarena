import { z } from "zod";
import type { ActionResult, Address } from "@/types";
import type { CustomerClient } from "./supabase";
import type { CustomerAddressInput } from "./validation";

/**
 * Saved-address CRUD against public.customer_addresses (migration
 * 20261116000700) via the customer client + own-row RLS. Every query
 * also filters explicitly by user_id so a policy regression fails
 * closed. Address ids are UUIDs, validated before querying.
 *
 * Before the migration is applied, reads fail and yield [] (the
 * addresses page shows its empty state) while writes fail honestly —
 * the dashboard keeps working and nothing pretends to persist.
 */

export const customerAddressRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  label: z.string(),
  full_name: z.string(),
  phone: z.string(),
  division: z.string(),
  district: z.string(),
  area: z.string(),
  address_line: z.string(),
  is_default: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export const CUSTOMER_ADDRESS_COLUMNS =
  "id,user_id,label,full_name,phone,division,district,area,address_line,is_default,created_at,updated_at";

/** Project one address row; null when the row fails validation. */
export function projectCustomerAddress(row: unknown): Address | null {
  const parsed = customerAddressRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    id: data.id,
    label: data.label,
    fullName: data.full_name,
    phone: data.phone,
    division: data.division,
    district: data.district,
    area: data.area,
    addressLine: data.address_line,
    isDefault: data.is_default,
  };
}

/** Own addresses, default first. Read failures yield [] (see header). */
export async function readCustomerAddresses(
  client: CustomerClient,
  userId: string,
): Promise<Address[]> {
  const result = await client
    .from("customer_addresses")
    .select(CUSTOMER_ADDRESS_COLUMNS)
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (result.error || !Array.isArray(result.data)) return [];
  const addresses: Address[] = [];
  for (const row of result.data) {
    const projected = projectCustomerAddress(row);
    if (projected) addresses.push(projected);
  }
  return addresses;
}

const saveFailure: ActionResult<Address> = {
  ok: false,
  reason: "error",
  message: "Your address could not be saved. Please try again.",
};

/** Clear the default flag on the customer's other addresses (same-user scope only). */
async function clearOtherDefaults(
  client: CustomerClient,
  userId: string,
): Promise<boolean> {
  const cleared = await client
    .from("customer_addresses")
    .update({ is_default: false })
    .eq("user_id", userId)
    .eq("is_default", true);
  return !cleared.error;
}

function addressColumns(input: CustomerAddressInput) {
  return {
    label: input.label,
    full_name: input.fullName,
    phone: input.phone,
    division: input.division,
    district: input.district,
    area: input.area,
    address_line: input.addressLine,
    is_default: input.isDefault,
  };
}

/**
 * Insert (id "") or update (UUID id) one own address. The partial
 * unique index on (user_id) WHERE is_default is the race-free guard
 * for "at most one default"; clearing first keeps the common path
 * conflict-free.
 */
export async function saveCustomerAddress(
  client: CustomerClient,
  userId: string,
  input: CustomerAddressInput,
): Promise<ActionResult<Address>> {
  if (input.isDefault) {
    if (!(await clearOtherDefaults(client, userId))) return saveFailure;
  }
  if (input.id === "") {
    const inserted = await client
      .from("customer_addresses")
      .insert({ ...addressColumns(input), user_id: userId })
      .select(CUSTOMER_ADDRESS_COLUMNS)
      .single();
    if (inserted.error) return saveFailure;
    const projected = projectCustomerAddress(inserted.data);
    return projected ? { ok: true, data: projected } : saveFailure;
  }
  const updated = await client
    .from("customer_addresses")
    .update(addressColumns(input))
    .eq("id", input.id)
    .eq("user_id", userId)
    .select(CUSTOMER_ADDRESS_COLUMNS)
    .maybeSingle();
  if (updated.error) return saveFailure;
  if (!updated.data) {
    return {
      ok: false,
      reason: "validation",
      message: "This address no longer exists.",
    };
  }
  const projected = projectCustomerAddress(updated.data);
  return projected ? { ok: true, data: projected } : saveFailure;
}

/** Delete one own address. Idempotent: deleting a missing id succeeds silently. */
export async function deleteCustomerAddress(
  client: CustomerClient,
  userId: string,
  addressId: string,
): Promise<ActionResult> {
  if (!z.uuid().safeParse(addressId).success) {
    return {
      ok: false,
      reason: "validation",
      message: "This address no longer exists.",
    };
  }
  const deleted = await client
    .from("customer_addresses")
    .delete()
    .eq("id", addressId)
    .eq("user_id", userId);
  if (deleted.error) {
    return {
      ok: false,
      reason: "error",
      message: "Your address could not be deleted. Please try again.",
    };
  }
  return { ok: true, data: undefined };
}
