import { Clock, Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { ContactForm } from "@/components/info/ContactForm";
import { InfoHeader } from "@/components/info/InfoPage";
import { footer } from "@/config";

export const metadata: Metadata = { title: "Contact Us" };

export default function ContactPage() {
  const c = footer.contact;
  const items = [
    { Icon: Phone, label: "Phone", value: c.phone, href: `tel:${c.phone.replace(/[^+\d]/g, "")}` },
    { Icon: Mail, label: "Email", value: c.email, href: `mailto:${c.email}` },
    { Icon: MapPin, label: "Address", value: c.address },
    { Icon: Clock, label: "Hours", value: c.hours },
  ];
  return (
    <>
      <InfoHeader title="Contact Us" eyebrow="We're here to help" intro="Questions about an order, sizing or returns? Send us a message and our team will get back to you." />
      <div className="container grid gap-10 py-10 lg:grid-cols-[1fr_380px]">
        <section className="rounded-card border border-line p-5 sm:p-8">
          <h2 className="mb-6 font-serif text-3xl text-ink">Send a message</h2>
          <ContactForm />
        </section>
        <aside className="space-y-3">
          {items.map(({ Icon, label, value, href }) => (
            <div key={label} className="flex items-start gap-4 rounded-card border border-line p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-selected text-primary">
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-ink-muted">{label}</p>
                {href ? (
                  <a href={href} className="mt-0.5 block break-words text-sm text-ink hover:text-primary hover:underline">
                    {value}
                  </a>
                ) : (
                  <p className="mt-0.5 break-words text-sm text-ink">{value}</p>
                )}
              </div>
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
