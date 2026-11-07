import { useEffect } from "react";

/** Tracks the visual viewport so the composer stays above the on-screen keyboard on mobile. */
export function useViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    const set = () => document.documentElement.style.setProperty("--app-h", `${Math.round(vv?.height ?? window.innerHeight)}px`);
    set();
    vv?.addEventListener("resize", set);
    window.addEventListener("resize", set);
    return () => { vv?.removeEventListener("resize", set); window.removeEventListener("resize", set); };
  }, []);
}
