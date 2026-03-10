/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Background colors
        'bg-primary': '#F5F1EB',
        'bg-secondary': '#EDE8E0',
        'bg-tertiary': '#E5DED4',
        
        // Surface colors
        'surface-primary': '#FFFFFF',
        'surface-secondary': '#FAF8F5',
        'surface-pressed': '#F0EDE8',
        
        // Text colors
        'text-primary': '#2D2A26',
        'text-secondary': '#5C5852',
        'text-tertiary': '#8A8580',
        'text-inverse': '#FFFFFF',
        
        // Accent colors
        'accent-positive': '#4A7C59',
        'accent-positive-light': '#E8F5E9',
        'accent-negative': '#B85450',
        'accent-negative-light': '#FFEBEE',
        'accent-primary': '#8B7355',
        'accent-primary-light': '#D4C5B5',
        'accent-amber': '#C4A35A',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        'number-lg': ['28px', { lineHeight: '32px', fontWeight: '600' }],
        'number-md': ['22px', { lineHeight: '28px', fontWeight: '600' }],
        'number-sm': ['17px', { lineHeight: '22px', fontWeight: '600' }],
        'caption': ['12px', { lineHeight: '16px', fontWeight: '500' }],
      },
      spacing: {
        'touch': '44px',
        'button': '56px',
      },
      borderRadius: {
        'card': '16px',
        'button': '12px',
        'input': '8px',
      },
      boxShadow: {
        'card': '0 2px 8px rgba(45, 42, 38, 0.08)',
        'modal': '0 10px 40px rgba(45, 42, 38, 0.15)',
      },
      minHeight: {
        'touch': '44px',
        'button': '56px',
        'list-item': '60px',
      },
    },
  },
  plugins: [],
}