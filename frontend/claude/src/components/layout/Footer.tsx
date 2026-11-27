"use client";
import {
  Facebook,
  Instagram,
  MapPin,
  Music2,
  MessageCircle,
  Phone,
  Youtube,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useStorefront } from "@/context/StorefrontContext";
import type { SocialLink } from "@/types";
import { developerContact } from "@/config/contact";
import { Logo } from "./Logo";
import styles from "./Footer.module.css";
const socialIcons: Record<SocialLink["network"], typeof Facebook> = {
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  tiktok: Music2,
  whatsapp: MessageCircle,
};
function configuredUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
/**
 * tel: link for the saved store phone. The owner saves the number as
 * dialled locally (01886456664); the link uses the international form
 * (+8801886456664) so it dials from any phone. Display keeps the saved
 * value unchanged.
 */
function telHref(phone: string): string {
  const digits = phone.replace(/[^+\d]/g, "");
  if (/^01[3-9]\d{8}$/.test(digits)) return `tel:+880${digits.slice(1)}`;
  return `tel:${digits}`;
}
export function Footer() {
  const { footer } = useStorefront();
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.content}`}>
        <div className={styles.grid}>
          <div className={styles.identity}>
            <div className={styles.branding}>
              <Logo variant="inverse" small />
              <Image src="/brand/wordmark-white.png" alt="" width={222} height={19} className={styles.wordmark} />
            </div>
            <nav aria-label="Social media">
            <ul className={styles.social}>
              {footer.social.map((s) => {
                const Icon = socialIcons[s.network];
                const href = configuredUrl(s.href);
                const label =
                  s.network === "tiktok"
                    ? "TikTok"
                    : s.network === "youtube"
                      ? "YouTube"
                      : s.network.charAt(0).toUpperCase() + s.network.slice(1);
                return (
                  <li key={s.network}>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${label} (opens in new tab)`}
                      >
                        <Icon aria-hidden size={19} />
                      </a>
                    ) : (
                      <span
                        className={styles.unconfigured}
                        role="img"
                        aria-label={`${label} — link not configured`}
                        title={`${label} link not configured`}
                      >
                        <Icon aria-hidden size={19} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            </nav>
            {/* Footer about text (admin footer_about, wired to
                footer.tagline by applyFooterOverride). It was saved but
                never rendered — the footer only showed a hardcoded
                "Style Elevated. Always." line — so the owner's text
                looked broken. */}
            {footer.tagline ? (
              <p className={styles.about}>{footer.tagline}</p>
            ) : null}
            {/* Client feedback item 8: the store phone shows below the
                social icons once the owner saves a real number in admin
                (contact_phone); on Preview/staging the layout substitutes
                a sample number. The "+880 1XXX-XXXXXX" config placeholder
                is never shown. */}
            {footer.contact.phone && !footer.contact.phone.includes("X") && (
              <p className={styles.address}>
                <Phone className={styles.addressIcon} aria-hidden size={15} />
                <a href={telHref(footer.contact.phone)}>{footer.contact.phone}</a>
              </p>
            )}
            {/* Store address (footer.contact.address, "Barishal, Bangladesh").
                The Footer never rendered contact details before 2026-11-21,
                so the ae73a87 config change (Dhaka -> Barishal) was invisible:
                no address line showed at all. */}
            {footer.contact.address && (
              <p className={styles.address}>
                <MapPin className={styles.addressIcon} aria-hidden size={15} />
                {footer.contact.address}
              </p>
            )}
          </div>
          {footer.columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2>{col.title}</h2>
              <ul className={styles.links}>
                {col.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className={styles.bottom}>
          <div className={styles.copyright}>
            <p>
              {footer.copyright.replace(
                "{year}",
                String(new Date().getFullYear()),
              )}
            </p>
            <p className={styles.tagline}>Style Elevated. Always.</p>
          </div>
          <p className={styles.credit}>Developed by <a href={developerContact.whatsappUrl} target="_blank" rel="noopener noreferrer" aria-label={`${developerContact.name} (opens in new tab)`} className={styles.developerLink}><strong>{developerContact.name}</strong></a></p>
        </div>
      </div>
    </footer>
  );
}
