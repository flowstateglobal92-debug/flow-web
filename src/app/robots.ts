import type { MetadataRoute } from "next";
import { SITE, abs } from "@/lib/site";

/**
 * Everything is public and we want it read — by search engines and by AI
 * crawlers alike. The AI agents are listed explicitly rather than relying on
 * the wildcard so the intent is unambiguous to operators that look for their
 * own token (and so a future disallow is a one-line change per agent).
 */
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot",
  "Applebot-Extended",
  "Bingbot",
  "meta-externalagent",
  "Amazonbot",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "DuckAssistBot",
  "MistralAI-User",
  "YouBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/_next/static/chunks/"] },
      ...AI_AGENTS.map((userAgent) => ({ userAgent, allow: "/", disallow: "/admin" })),
    ],
    sitemap: abs("/sitemap.xml"),
    host: SITE.url,
  };
}
