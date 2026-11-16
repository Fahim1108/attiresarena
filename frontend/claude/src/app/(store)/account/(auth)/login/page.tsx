import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/account/AuthForms";
import { allowlistedCustomerDestination, customerCallbackDestination } from "@/lib/customer/redirects";
import { customerSession } from "@/lib/customer/session";

export const metadata: Metadata = { title: "Sign In" };

export default async function LoginPage({
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
      <h1 className="text-center font-serif text-4xl text-ink">Welcome back</h1>
      <p className="mb-7 mt-2 text-center text-sm text-ink-muted">Sign in to track orders and save your favourites.</p>
      <LoginForm next={next} />
      <p className="mt-6 text-center text-sm text-ink-muted">
        New to Attires Arena?{" "}
        <Link href="/account/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
