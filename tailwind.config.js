/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        night: "#12051f",
        plum: "#1f0a34",
        aurora: "#2c0f4a",
        gold: "#f2c46d",
        goldBright: "#ffd58a",
        violetGlow: "#7c4dff",
        softWhite: "#f5f2ff"
      },
      boxShadow: {
        glow: "0 0 25px rgba(242, 196, 109, 0.35)",
        soft: "0 10px 30px rgba(10, 2, 24, 0.45)"
      },
      fontFamily: {
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        body: ["Sora", "system-ui", "sans-serif"]
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" }
        },
        floaty: {
          "0%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
          "100%": { transform: "translateY(0px)" }
        },
        pop: {
          "0%": { transform: "scale(1)", boxShadow: "0 0 0 rgba(242, 196, 109, 0)" },
          "60%": { transform: "scale(1.03)", boxShadow: "0 0 22px rgba(242, 196, 109, 0.35)" },
          "100%": { transform: "scale(1)", boxShadow: "0 0 0 rgba(242, 196, 109, 0)" }
        }
      },
      animation: {
        shimmer: "shimmer 2.5s linear infinite",
        floaty: "floaty 4s ease-in-out infinite",
        pop: "pop 500ms ease"
      }
    }
  },
  plugins: []
};
