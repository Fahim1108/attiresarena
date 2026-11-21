import { describe, expect, it } from "vitest";
import { buildSeoHeaders, CONTENT_SECURITY_POLICY } from "../src/lib/seo";

/**
 * Security headers (2026-11-21 security fix): CSP + HSTS +
 * Permissions-Policy on top of the existing nosniff / DENY / referrer
 * headers. The CSP allowlist must cover everything the site actually
 * loads — Next.js inline scripts, Meta Pixel, Google Analytics,
 * Supabase data/media, and the privacy-enhanced YouTube embed — or
 * the headers themselves break the storefront.
 */
describe("security headers", () => {
  const globalHeaders = (env: { VERCEL_ENV?: string; NODE_ENV?: string }) => {
    const entries = buildSeoHeaders(env);
    const global = entries.find((entry) => entry.source === "/:path*");
    expect(global).toBeDefined();
    return new Map(global!.headers.map((header) => [header.key, header.value]));
  };

  it("sends CSP, HSTS and Permissions-Policy on every build env", () => {
    for (const env of [
      { VERCEL_ENV: "production" },
      { VERCEL_ENV: "preview", NODE_ENV: "production" },
      {},
    ]) {
      const headers = globalHeaders(env);
      expect(headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
      expect(headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
      expect(headers.get("Permissions-Policy")).toBe(
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
      );
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("X-Frame-Options")).toBe("DENY");
      expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    }
  });

  it("CSP allows the scripts the site actually runs (Next, Pixel, GA)", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'unsafe-inline' https://connect.facebook.net https://www.googletagmanager.com");
    expect(CONTENT_SECURITY_POLICY).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("CSP allows Supabase data/media and the analytics beacons", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("https://*.supabase.co");
    expect(CONTENT_SECURITY_POLICY).toContain("https://*.google-analytics.com");
    expect(CONTENT_SECURITY_POLICY).toContain("https://www.facebook.com");
  });

  it("CSP allows the YouTube-nocookie product embed and nothing else framed", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-src 'self' https://www.youtube-nocookie.com");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("form-action 'self'");
  });

  it("CSP never allows unsafe-eval or a wildcard source", () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(CONTENT_SECURITY_POLICY).not.toContain(" *;");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/[^a-z]http:/);
  });
});
