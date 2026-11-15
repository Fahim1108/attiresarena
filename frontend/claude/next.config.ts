import type { NextConfig } from "next";

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
  async redirects() { return [{source:"/admin/taxonomy",destination:"/admin/catalogue",permanent:true}]; },
  async headers() { return [{source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},{key:"X-Robots-Tag",value:"noindex, nofollow"}]}]; },
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
