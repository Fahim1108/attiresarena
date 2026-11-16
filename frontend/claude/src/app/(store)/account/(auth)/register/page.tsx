import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/account/AuthForms";
import { allowlistedCustomerDestination, customerCallbackDestination } from "@/lib/customer/redirects";
import { customerSession } from "@/lib/customer/session";

export const metadata: Metadata = { title: "Create Account" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const session = await customerSession();
  if (session) redirect(customerCallbackDestination(params?.next));
  const next = allowlistedCustomerDestination(params?.next);
  return (
    <>
      <h1 className="text-center font-serif text-4xl text-ink">Create account</h1>
      <p className="mb-7 mt-2 text-center text-sm text-ink-muted">Faster checkout, order tracking and a saved wishlist.</p>
      <RegisterForm next={next} />
      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/account/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
