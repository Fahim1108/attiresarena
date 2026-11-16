import { customerSession, metadataDisplayName } from "@/lib/customer/session";
import { CustomerMenu } from "./CustomerMenu";

/**
 * Server-side header menu state. Reads the customer session (React.cache
 * dedupes it with the page's own read) and passes only presence + the
 * metadata display name down — no extra profile query on every page,
 * no whole user object across the RSC boundary. Rendered behind
 * Suspense in the store layout so the session read never blocks the
 * page shell.
 */
export async function CustomerMenuLoader() {
  const session = await customerSession();
  if (!session) return <CustomerMenu />;
  return (
    <CustomerMenu
      signedIn
      displayName={metadataDisplayName(session.user.user_metadata) || undefined}
    />
  );
}
