"use client";
import {
  Facebook,
  Instagram,
  MapPin,
  Music2,
  MessageCircle,
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
            {/* Store address (footer.contact.address, "Barishal, Bangladesh").
                The Footer never rendered contact details before 2026-11-21,
                so the ae73a87 config change (Dhaka -> Barishal) was invisible:
                no address line showed at all. Only the address is shown here
                — phone/email stay placeholder values in the config and must
                not render until the owner supplies real ones. */}
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
