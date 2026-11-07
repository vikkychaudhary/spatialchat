// Minimal privacy-aware logger. Never pass passwords, cookies, tokens or message bodies to it.
const enabled = process.env.NODE_ENV !== "test";
export const log = {
  info: (msg: string) => enabled && console.log(`[info] ${msg}`),
  warn: (msg: string) => enabled && console.warn(`[warn] ${msg}`),
  error: (msg: string, err?: unknown) => {
    if (!enabled) return;
    // Only the error name/message is logged; stack traces can leak internals and are omitted in production.
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : "";
    console.error(`[error] ${msg}${detail ? ` - ${detail}` : ""}`);
  },
};
