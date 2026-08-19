"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Renders an email body the way a mail client should: inside a sandboxed frame
 * with its own content-security policy.
 *
 * `sandbox` without `allow-scripts` means nothing in the message executes;
 * `allow-same-origin` is only there so the height can be measured after load.
 * Remote images stay blocked until asked for — an unrequested remote image is
 * how senders find out the mail was opened.
 *
 * The caller keys this on the message so each one starts from a fresh height.
 */
export default function MessageBody({
  html,
  text,
  showRemoteImages,
}: {
  html: string | null;
  text: string | null;
  showRemoteImages: boolean;
}) {
  const observer = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(260);

  const srcDoc = html
    ? `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${
        showRemoteImages ? "data: https: http:" : "data:"
      }; style-src 'unsafe-inline'; font-src data:; media-src 'none';">
<base target="_blank">
<style>
  html,body{margin:0;padding:18px 20px;background:#fbf7f1;color:#1b1a18;
    font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
    overflow-wrap:anywhere;word-break:break-word;}
  img,table,video{max-width:100%!important;height:auto;}
  table{border-collapse:collapse;}
  a{color:#a94a2c;}
  blockquote{margin:12px 0;padding-left:12px;border-left:3px solid #e0d5c6;color:#5a5249;}
  pre{white-space:pre-wrap;}
</style></head><body>${html}</body></html>`
    : null;

  /**
   * Grows the frame to fit its content and keeps watching it: remote images
   * finish loading long after `load` fires, and the reading pane is a different
   * width on a phone than on a desk.
   *
   * This runs from a ref callback rather than `onLoad` because the frame is
   * server-rendered — it has already loaded by the time React hydrates, so the
   * load event would have come and gone unheard.
   */
  const attach = useCallback((node: HTMLIFrameElement | null) => {
    if (!node) return;

    const fit = () => {
      const doc = node.contentDocument;
      if (!doc) return;
      const measure = () =>
        setHeight((prev) => {
          const next = Math.min(Math.max(doc.documentElement.scrollHeight + 8, 160), 20000);
          return Math.abs(next - prev) > 2 ? next : prev;
        });

      measure();
      observer.current?.disconnect();
      observer.current = new ResizeObserver(measure);
      observer.current.observe(doc.documentElement);
    };

    node.addEventListener("load", fit);
    if (node.contentDocument?.readyState !== "loading") fit();

    return () => {
      node.removeEventListener("load", fit);
      observer.current?.disconnect();
      observer.current = null;
    };
  }, []);

  if (!srcDoc) {
    return (
      <div className="whitespace-pre-wrap break-words border border-cream/[0.08] bg-ink/50 px-4 py-3.5 text-[13px] leading-relaxed text-cream-2">
        {text?.trim() || "This message has no body."}
      </div>
    );
  }

  return (
    <iframe
      ref={attach}
      title="Message"
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      style={{ height }}
      className="w-full border border-cream/[0.08] bg-[#fbf7f1]"
    />
  );
}
