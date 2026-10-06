"use client";

import { useEffect } from "react";
import { Icon } from "@/components/admin/icons";
import { Button } from "@/components/admin/ui";
import { WORDMARK_SRC } from "./InvoiceDocument";

/** Wait until the type and every image (the masked wordmark too) are ready — a PDF of half-loaded fonts is worse than none. */
async function ready() {
  await document.fonts.ready;
  const images = Array.from(document.images).map((img) => img.decode().catch(() => undefined));
  const mark = new window.Image();
  mark.src = WORDMARK_SRC;
  images.push(mark.decode().catch(() => undefined));
  await Promise.all(images);
}

export function PrintButton() {
  return (
    <Button
      variant="primary"
      onClick={() => {
        void ready().then(() => window.print());
      }}
    >
      <Icon.printer size={14} /> Print / Save PDF
    </Button>
  );
}

/** `?print=1` opens the dialog once everything has loaded, then drops the flag so a reload doesn't reprint. */
export function AutoPrint() {
  useEffect(() => {
    let cancelled = false;
    void ready().then(() => {
      if (cancelled) return;
      window.print();
      const url = new URL(window.location.href);
      url.searchParams.delete("print");
      window.history.replaceState(window.history.state, "", url);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
