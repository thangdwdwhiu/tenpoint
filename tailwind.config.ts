import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0b0e13",
        panel: "#11151c",
        line: "#222833",
        muted: "#8791a2",
        accent: "#8b7bff",
      },
      boxShadow: {
        glow: "0 0 32px rgba(139, 123, 255, 0.18)",
      },
    },
  },
  plugins: [],
};

export default config;
