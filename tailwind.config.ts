/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#1c6ee7",
        "primary-strong": "#1455b3",
        "primary-soft": "rgba(28,110,231,0.10)",
        accent: "#8fb4e3",
        success: "#0f8f5f",
        danger: "#a84534",
        muted: "#667487",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
