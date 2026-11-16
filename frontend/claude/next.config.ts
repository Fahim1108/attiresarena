import type { NextConfig } from "next";
import { buildSeoHeaders, buildSeoRedirects } from "./src/lib/seo";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Admin image uploads send one validated file (<=5 MB) per action call;
      // the 1 MB default would reject larger product photos at the framework.
      bodySizeLimit: "6mb",
    },
  },
  // The admin page for categories, brands and collections moved from /admin/taxonomy.
  // Redirects + headers branch on BUILD-TIME env only (see src/lib/seo):
  // production builds scope X-Robots-Tag to private paths and add the
  // host-scoped www -> apex redirect; every other build fails closed to
  // the global noindex header with no www redirect.
  async redirects() { return buildSeoRedirects(process.env); },
  async headers() { return buildSeoHeaders(process.env); },
  images: {
    // Placeholder artwork ships as local SVG. When real product photography is
    // served from Supabase Storage / a CDN, add its host to `remotePatterns`.
    dangerouslyAllowSVG: false,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [],
  },
};

export default nextConfig;
