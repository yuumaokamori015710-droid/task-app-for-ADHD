/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1e3a5f',
          dark: '#162d4a',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Hiragino Sans"',
          '"Noto Sans JP"', 'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
