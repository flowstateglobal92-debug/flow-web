import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * Web app manifest. Without one, Android falls back to a screenshot of the
 * favicon when the site is added to a home screen; with it the mark is used at
 * the right density and the splash matches the site's own ink.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — ${SITE.tagline}`,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    background_color: "#0b0806",
    theme_color: "#0b0806",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
