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
          bg: '#ffffff',
          surface: '#f8f9fa',
          card: '#ffffff',
          border: '#e9ecef',
          text: {
            primary: '#212529',
            secondary: '#6c757d',
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