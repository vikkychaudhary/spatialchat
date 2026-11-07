export type ThemePref = "dark" | "light" | "system";
const KEY = "spatialchat-theme";

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" || v === "system" ? v : "system";
  } catch { return "system"; }
}
export function applyTheme(pref: ThemePref = getThemePref()) {
  const resolved = pref === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = resolved;
}
export function setThemePref(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* storage may be unavailable */ }
  applyTheme(pref);
}
