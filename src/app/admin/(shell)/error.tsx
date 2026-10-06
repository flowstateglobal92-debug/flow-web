"use client";

import { useEffect } from "react";
import { Button, EmptyState } from "@/components/admin/ui";

/**
 * Anything a page inside the shell throws lands here instead of replacing the
 * whole admin: the rail and the bar stay, and "Try again" re-fetches just
 * this page. Server errors arrive with a digest (the message stays on the
 * server), which is what the logs are searched by.
 */
export default function ShellError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      title="This page ran into a problem"
      hint={
        error.digest
          ? `Try again. If it keeps happening, pass on this reference: ${error.digest}`
          : "Try again. If it keeps happening, reload the page."
      }
      action={
        <Button variant="primary" onClick={() => retry()}>
          Try again
        </Button>
      }
    />
  );
}
