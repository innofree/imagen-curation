import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        panel: "#1b1b1d",
        panel2: "#232326",
        edge: "#333338",
      },
    },
  },
  plugins: [],
} satisfies Config;
