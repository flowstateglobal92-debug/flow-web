/**
 * Tiny page-reveal signal. The preloader calls `reveal()` when it starts its
 * exit; hero pieces (headline intro, liquid pour) wait for it so they play
 * exactly as the veil lifts. Works without a preloader too: `waitForReveal`
 * resolves after `timeoutMs` as a safety net.
 */
let revealed = false;
const listeners = new Set<() => void>();

export function isRevealed() {
  return revealed;
}

export function reveal() {
  if (revealed) return;
  revealed = true;
  listeners.forEach((l) => l());
  listeners.clear();
}

/** Subscribe; returns an unsubscribe. Fires immediately if already revealed. */
export function onReveal(cb: () => void, timeoutMs = 9000): () => void {
  if (revealed) {
    cb();
    return () => {};
  }
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    listeners.delete(run);
    cb();
  };
  listeners.add(run);
  const t = setTimeout(run, timeoutMs);
  return () => {
    done = true;
    listeners.delete(run);
    clearTimeout(t);
  };
}
