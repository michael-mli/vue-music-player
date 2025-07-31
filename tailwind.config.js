/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        spotify: {
          green: '#1DB954',
          black: '#121212',
          dark: '#181818',
          light: '#282828',
        },
        // Light theme colors
        light: {
          bg: '#f5f5f5',
          surface: '#ffffff',
          card: '#ffffff',
          border: '#d1d5db',
          text: {
            primary: '#111827',
            secondary: '#6b7280',
          }
        }
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}