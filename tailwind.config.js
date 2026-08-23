/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9eaff',
          500: '#2b6cb0',
          600: '#1d4e89',
          700: '#163a66',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        thaana: ['"Noto Sans Thaana"', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
