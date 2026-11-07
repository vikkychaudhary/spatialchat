const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { ink: c("ink"), muted: c("muted"), accent: c("accent"), strong: c("accent-strong"), danger: c("danger"), ok: c("ok"), panel: c("panel"), line: c("line"), bg0: c("bg0") },
      fontFamily: { sans: ['"Segoe UI Variable"', '"Segoe UI"', "system-ui", "-apple-system", "Roboto", "Helvetica", "Arial", "sans-serif"] },
      minHeight: { touch: "2.75rem" },
      minWidth: { touch: "2.75rem" },
    },
  },
  plugins: [],
};
