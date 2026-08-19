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

  experimental: {
    serverActions: {
      // Outgoing mail carries its attachments through the Server Action body.
      // 20MB of files + multipart overhead — Resend's own ceiling is 40MB once
      // the payload is base64-encoded, which this stays under.
      bodySizeLimit: "22mb",
    },
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
    ];
  },
};

export default nextConfig;
