"use server";

import { redirect } from "next/navigation";
import type { ActionResult, Address } from "@/types";
import {
  deleteCustomerAddress,
  saveCustomerAddress,
} from "./addresses";
import { getCustomerAuthOrigin } from "./origin";
import { customerCallbackDestination } from "./redirects";
import {
  REVIEW_SIGN_IN_EXPIRED_MESSAGE,
  submitCustomerReview,
} from "./reviews";
import {
  resolveCustomerSession,
  type CustomerSession,
} from "./session";
import { customerClient } from "./supabase";
import {
  GOOGLE_IDENTITY_CONFLICT_MESSAGE,
  customerAddressSchema,
  customerNewPasswordSchema,
  customerPasswordResetRequestSchema,
  customerProfileSchema,
  customerRegisterSchema,
  customerReviewSchema,
  customerSignInSchema,
  isAlreadyRegisteredError,
  isIdentityConflictText,
  looksLikeBdPhone,
} from "./validation";

/**
 * Customer server actions. Every action authenticates inside itself
 * (never trusts layout/page guards) and validates input with zod.
 * Generic failure messages everywhere: nothing here reveals whether
 * an account exists for an email.
 *
 * Sign-in is email-only; Google sign-in uses the minimal scopes
 * 'openid email profile' with no extra query params and never links
 * or merges accounts automatically.
 */

const notConfigured: ActionResult<never> = {
  ok: false,
  reason: "not_connected",
  message: "Account access is temporarily unavailable. Please try again later.",
};

const signInAgain: ActionResult<never> = {
  ok: false,
  reason: "error",
  message: "Your sign-in expired. Please sign in again.",
};

function phoneIdentifierMessage(action: "sign in" | "reset your password") {
  const mobileClause =
    action === "sign in"
      ? "Mobile sign-in is not available."
      : "Mobile password reset is not available.";
  return `Use your email address to ${action}. ${mobileClause}`;
}

/** Authenticated customer session for a mutation, or null. */
async function authenticatedCustomer(): Promise<CustomerSession | null> {
  const client = await customerClient(true);
  if (!client) return null;
  return resolveCustomerSession(client);
}

export async function signInCustomer(
  input: unknown,
): Promise<ActionResult> {
  const parsed = customerSignInSchema.safeParse(input);
  if (!parsed.success) {
    const email = (input as { email?: unknown } | null)?.email;
    if (typeof email === "string" && looksLikeBdPhone(email)) {
      return {
        ok: false,
        reason: "validation",
        message: phoneIdentifierMessage("sign in"),
      };
    }
    return {
      ok: false,
      reason: "validation",
      message: "Enter a valid email address and password.",
    };
  }
  const client = await customerClient(true);
  if (!client) return notConfigured;
  const { error } = await client.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    return {
      ok: false,
      reason: "error",
      message: "Could not sign you in. Check your email and password.",
    };
  }
  return { ok: true, data: undefined };
}

export async function registerCustomer(
  input: unknown,
): Promise<ActionResult<{ signedIn: boolean }>> {
  const parsed = customerRegisterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message:
        "Enter your name, a valid email, a valid mobile number and a password of 8–128 characters.",
    };
  }
  const client = await customerClient(true);
  if (!client) return notConfigured;
  const origin = getCustomerAuthOrigin();
  if (!origin) return notConfigured;
  const { fullName, email, phone, password } = parsed.data;
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      // Transport for the email-confirmation case only: the callback
      // sync fills empty profile fields from this. Never an
      // authorization input; roles/permissions are never forwarded.
      data: { full_name: fullName, phone },
    },
  });
  if (error) {
    // Non-enumerating: an already-registered email gets the same
    // "check your email" outcome as a fresh confirmation-on sign-up.
    if (isAlreadyRegisteredError(error)) {
      return { ok: true, data: { signedIn: false } };
    }
    return {
      ok: false,
      reason: "error",
      message: "Could not create your account. Please try again.",
    };
  }
  if (data.session && data.user && !data.user.is_anonymous) {
    // Confirmation off: a session exists immediately, so write the
    // profile now. Display name first, phone separately, so a missing
    // phone column (migration unapplied) cannot lose the name. Both
    // best-effort: the profile form is the authoritative path.
    // NOTE (S2): confirmation-off sign-ups return signedIn:true here
    // while already-registered emails return signedIn:false above — a
    // distinguishable outcome until the dashboard "Confirm email"
    // setting is confirmed live. Current behavior pinned by test.
    await client
      .from("profiles")
      .update({ display_name: fullName })
      .eq("id", data.user.id);
    await client
      .from("profiles")
      .update({ phone })
      .eq("id", data.user.id);
    return { ok: true, data: { signedIn: true } };
  }
  return { ok: true, data: { signedIn: false } };
}

export async function requestCustomerPasswordReset(
  input: unknown,
): Promise<ActionResult> {
  const parsed = customerPasswordResetRequestSchema.safeParse(input);
  if (!parsed.success) {
    const email = (input as { email?: unknown } | null)?.email;
    if (typeof email === "string" && looksLikeBdPhone(email)) {
      return {
        ok: false,
        reason: "validation",
        message: phoneIdentifierMessage("reset your password"),
      };
    }
    return {
      ok: false,
      reason: "validation",
      message: "Enter a valid email address.",
    };
  }
  const client = await customerClient(true);
  if (!client) return notConfigured;
  const origin = getCustomerAuthOrigin();
  if (!origin) return notConfigured;
  // Always the same outcome: never reveal whether the account exists.
  // The emailed link lands on the reset page via the callback allowlist.
  await client.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/account/reset-password`,
  });
  return { ok: true, data: undefined };
}

/**
 * Set a new password from the reset page. Trusts the live session
 * (standard Supabase pattern): the installed @supabase/auth-js surface
 * exposes getClaims()/amr but documents no value that reliably
 * identifies a recovery session, so no amr gate is enforced — see
 * IMPLEMENTATION_NOTES.md (D10) for the evidence and the
 * live-verification item. Requires a live non-anonymous session.
 */
export async function setNewCustomerPassword(
  input: unknown,
): Promise<ActionResult> {
  const parsed = customerNewPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Use a password of 8–128 characters.",
    };
  }
  const session = await authenticatedCustomer();
  if (!session) return signInAgain;
  const { error } = await session.client.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return {
      ok: false,
      reason: "error",
      message:
        "Could not update your password. Request a new reset link and try again.",
    };
  }
  return { ok: true, data: undefined };
}

/** Sign out the CUSTOMER session only (aa-customer-auth); staff sessions are untouched. */
export async function signOutCustomer(): Promise<void> {
  const client = await customerClient(true);
  if (client) await client.auth.signOut({ scope: "local" });
  redirect("/");
}

export async function updateCustomerProfile(
  input: unknown,
): Promise<ActionResult> {
  const parsed = customerProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Enter your full name and a valid mobile number.",
    };
  }
  const session = await authenticatedCustomer();
  if (!session) return signInAgain;
  // Display name first, phone separately (mirroring registerCustomer),
  // so a missing phone column (migration unapplied) cannot lose the
  // name: the name save succeeds on its own, with an honest notice
  // when only the phone part fails.
  const { error: nameError } = await session.client
    .from("profiles")
    .update({ display_name: parsed.data.fullName })
    .eq("id", session.user.id);
  if (nameError) {
    return {
      ok: false,
      reason: "error",
      message: "Could not save your profile. Please try again.",
    };
  }
  const { error: phoneError } = await session.client
    .from("profiles")
    .update({ phone: parsed.data.phone })
    .eq("id", session.user.id);
  if (phoneError) {
    return {
      ok: true,
      data: undefined,
      message:
        "Your name was saved, but your mobile number could not be saved. Please try saving it again.",
    };
  }
  return { ok: true, data: undefined };
}

export async function saveCustomerAddressAction(
  input: unknown,
): Promise<ActionResult<Address>> {
  const parsed = customerAddressSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Check the address details and try again.",
    };
  }
  const session = await authenticatedCustomer();
  if (!session) return signInAgain;
  return saveCustomerAddress(session.client, session.user.id, parsed.data);
}

export async function deleteCustomerAddressAction(
  addressId: unknown,
): Promise<ActionResult> {
  const session = await authenticatedCustomer();
  if (!session) return signInAgain;
  if (typeof addressId !== "string") {
    return {
      ok: false,
      reason: "validation",
      message: "This address no longer exists.",
    };
  }
  return deleteCustomerAddress(session.client, session.user.id, addressId);
}

export async function submitCustomerReviewAction(
  input: unknown,
): Promise<ActionResult<{ reviewId: string }>> {
  const parsed = customerReviewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Check your review details and try again.",
    };
  }
  const session = await authenticatedCustomer();
  // Same text as signInAgain, via the shared constant: the review form
  // matches on it to switch back to the sign-in view.
  if (!session) {
    return {
      ok: false,
      reason: "error",
      message: REVIEW_SIGN_IN_EXPIRED_MESSAGE,
    };
  }
  return submitCustomerReview(session.client, parsed.data);
}

export type GoogleSignInState = { message: string } | null;

/**
 * Google sign-in entry point (form action). On success redirects to
 * the Supabase authorization URL; on failure returns a message for
 * the button to announce. No automatic linking/merging, no
 * linkIdentity call, no extra scopes or query params.
 */
export async function signInWithGoogle(
  _previous: GoogleSignInState,
  formData: FormData,
): Promise<GoogleSignInState> {
  const origin = getCustomerAuthOrigin();
  const client = origin ? await customerClient(true) : null;
  if (!origin || !client) {
    return {
      message:
        "Google sign-in is not available right now. Sign in with your email instead.",
    };
  }
  const rawNext = formData.get("next");
  const next = customerCallbackDestination(
    typeof rawNext === "string" ? rawNext : null,
  );
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      scopes: "openid email profile",
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) {
    if (
      error &&
      isIdentityConflictText(`${error.code ?? ""} ${error.message}`)
    ) {
      return { message: GOOGLE_IDENTITY_CONFLICT_MESSAGE };
    }
    return {
      message:
        "Google sign-in is not available right now. Sign in with your email instead.",
    };
  }
  redirect(data.url);
}
