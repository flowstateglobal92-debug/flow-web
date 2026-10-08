import type { NextConfig } from "next";

/**
 * Sent site-wide.
 *
 * No `default-src` or `script-src`: the app ships inline scripts (the intro
 * boot script, JSON-LD, Next's own hydration payload) and locking those down
 * properly needs per-request nonces. The directives here are the ones that
 * cost nothing and still close real holes — nobody can frame the admin, point
 * a <base> at their own host, or post a form off-origin.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // The framework and its version are nobody else's business.
  poweredByHeader: false,

  images: {
    // Default is WebP only. AVIF lands ~30% smaller at the same quality and
    // next/image negotiates per request, so anything that can't take it still
    // gets the WebP.
    formats: ["image/avif", "image/webp"],
  },

  experimental: {
    serverActions: {
      // Outgoing mail carries its attachments through the Server Action body.
      // 20MB of files + multipart overhead — Resend's own ceiling is 40MB once
      // the payload is base64-encoded, which this stays under.
      bodySizeLimit: "22mb",
    },
    // src/proxy.ts matches /admin/*, and Next buffers a proxied request body
    // only up to this size (10MB by default), silently cutting off the rest.
    // Keep it level with bodySizeLimit so a mail attachment that the action
    // accepts isn't truncated on the way in. (Receipts don't come this way:
    // they upload from the browser straight to Storage.)
    proxyClientMaxBodySize: "22mb",
  },

  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        // Admin pages are per-user and per-request. Dynamic rendering already
        // implies this, but say it out loud so no proxy in between decides to
        // hold a copy of somebody's inbox.
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        // The pay-online page (0039) posts to PayHere's checkout and is sent on
        // to Stripe's — those two, and only from here. Later rules win over the
        // site-wide one for the same header. Never cached, never indexed.
        source: "/pay/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "base-uri 'self'; form-action 'self' https://www.payhere.lk https://sandbox.payhere.lk https://checkout.stripe.com; frame-ancestors 'none'; object-src 'none'",
          },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
