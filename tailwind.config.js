module.exports = {
  content: ["./index.html", "./renderer-scripts/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: "#1b2936",
        mist: "#f4f6f2",
        brass: "#a46b2d",
        kiln: "#b5442d",
        pine: "#365246",
        slate: {
          DEFAULT: "#5c6c7a",
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          500: "#64748b",
          700: "#334155"
        }
      },
      fontFamily: {
        sans: ["Segoe UI", "Microsoft JhengHei UI", "sans-serif"]
      },
      boxShadow: {
        panel: "0 16px 40px rgba(27, 41, 54, 0.12)"
      }
    }
  },
  plugins: []
};
