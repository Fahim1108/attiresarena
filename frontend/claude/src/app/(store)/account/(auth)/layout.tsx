import { publicSupabaseConfiguration } from "@/lib/supabase-public";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const configured = publicSupabaseConfiguration() !== null;
  return (
    <div className="container flex justify-center py-10 sm:py-16">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-soft sm:p-9">
        {configured ? (
          children
        ) : (
          <p role="note" className="text-center text-sm leading-relaxed text-ink-muted">
            Account access is temporarily unavailable. Please try again later.
          </p>
        )}
      </div>
    </div>
  );
}
