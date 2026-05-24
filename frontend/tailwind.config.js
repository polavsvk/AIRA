/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'aira-dark': '#050510',
        'aira-darker': '#030308',
        'aira-panel': '#0d1117',
        'aira-border': '#1a2332',
        'aira-blue': '#00d4ff',
        'aira-blue-dim': '#0099bb',
        'aira-gold': '#ffd700',
        'aira-gold-dim': '#b8960c',
        'aira-red': '#ff4444',
        'aira-green': '#00ff88',
        'aira-text': '#c9d1d9',
        'aira-text-dim': '#8b949e',
      },
      fontFamily: {
        'mono': ['JetBrains Mono', 'Fira Code', 'monospace'],
        'sans': ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'aira-glow': '0 0 20px rgba(0, 212, 255, 0.15)',
        'aira-glow-strong': '0 0 40px rgba(0, 212, 255, 0.3)',
        'gold-glow': '0 0 20px rgba(255, 215, 0, 0.2)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'typing': 'typing 1s steps(3) infinite',
        'fadeIn': 'fadeIn 0.3s ease-in',
        'slideUp': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(0, 212, 255, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(0, 212, 255, 0.5)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      }
    },
  },
  plugins: [],
}
