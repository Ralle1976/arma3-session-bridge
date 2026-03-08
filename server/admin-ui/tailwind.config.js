/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f9ff',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          900: '#0c4a6e',
        },
        base: '#060b12',
        surface: '#0e1825',
        raised: '#162233',
        hover: '#1e3048',
        accent: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
          bright: '#60a5fa',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      boxShadow: {
        'glass-sm':    '0 2px 6px rgba(0,5,15,0.55), 0 6px 18px rgba(0,10,30,0.4), 0 0 0 1px rgba(59,130,246,0.05)',
        'glass':       '0 4px 12px rgba(0,5,20,0.6), 0 12px 32px rgba(0,10,40,0.5), 0 24px 56px rgba(0,5,25,0.35), 0 0 0 1px rgba(59,130,246,0.07)',
        'glass-lg':    '0 8px 24px rgba(0,5,20,0.7), 0 20px 50px rgba(0,10,40,0.6), 0 40px 80px rgba(0,5,30,0.45), 0 0 0 1px rgba(59,130,246,0.1)',
        'glass-float': '0 16px 40px rgba(0,5,20,0.8), 0 32px 72px rgba(0,10,45,0.65), 0 60px 100px rgba(0,5,30,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
        'glow-accent':    '0 0 12px rgba(59,130,246,0.4), 0 0 28px rgba(59,130,246,0.2), 0 0 48px rgba(59,130,246,0.08)',
        'glow-accent-sm': '0 0 8px rgba(59,130,246,0.35), 0 0 18px rgba(59,130,246,0.15)',
        'glow-green':  '0 0 10px rgba(34,197,94,0.5), 0 0 24px rgba(34,197,94,0.25), 0 0 42px rgba(34,197,94,0.1)',
        'glow-red':    '0 0 10px rgba(239,68,68,0.5), 0 0 24px rgba(239,68,68,0.25), 0 0 42px rgba(239,68,68,0.1)',
        'input-inset': 'inset 0 2px 8px rgba(0,5,20,0.55), inset 0 1px 3px rgba(0,0,0,0.4)',
      },
      borderColor: {
        'glass':        'rgba(59,130,246,0.12)',
        'glass-strong': 'rgba(96,165,250,0.22)',
        'glass-glow':   'rgba(96,165,250,0.35)',
      },
      backdropBlur: {
        'glass':    '12px',
        'glass-lg': '16px',
      },
    },
  },
  plugins: [],
}
