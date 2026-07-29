import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './node_modules/streamdown/dist/*.js'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        gray: colors.zinc,
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar) / <alpha-value>)',
          foreground: 'hsl(var(--sidebar-foreground) / <alpha-value>)',
        },
        // 皮肤驱动的品牌色板：让全局写死的 blue-* 随配色方案（默认 / Apple / 小米）变化
        blue: {
          50: 'hsl(var(--skin-blue-50) / <alpha-value>)',
          100: 'hsl(var(--skin-blue-100) / <alpha-value>)',
          200: 'hsl(var(--skin-blue-200) / <alpha-value>)',
          300: 'hsl(var(--skin-blue-300) / <alpha-value>)',
          400: 'hsl(var(--skin-blue-400) / <alpha-value>)',
          500: 'hsl(var(--skin-blue-500) / <alpha-value>)',
          600: 'hsl(var(--skin-blue-600) / <alpha-value>)',
          700: 'hsl(var(--skin-blue-700) / <alpha-value>)',
          800: 'hsl(var(--skin-blue-800) / <alpha-value>)',
          900: 'hsl(var(--skin-blue-900) / <alpha-value>)',
          950: 'hsl(var(--skin-blue-950) / <alpha-value>)',
        },
        ds: {
          canvas: 'hsl(var(--ds-color-canvas) / <alpha-value>)',
          surface: 'hsl(var(--ds-color-surface) / <alpha-value>)',
          subtle: 'hsl(var(--ds-color-surface-subtle) / <alpha-value>)',
          text: 'hsl(var(--ds-color-text) / <alpha-value>)',
          muted: 'hsl(var(--ds-color-text-muted) / <alpha-value>)',
          border: 'hsl(var(--ds-color-border) / <alpha-value>)',
          primary: 'hsl(var(--ds-color-primary) / <alpha-value>)',
          selection: 'hsl(var(--ds-color-selection-surface) / <alpha-value>)',
          'selection-border': 'hsl(var(--ds-color-selection-border) / <alpha-value>)',
          'selection-text': 'hsl(var(--ds-color-selection-text) / <alpha-value>)',
          success: 'hsl(var(--ds-color-success) / <alpha-value>)',
          warning: 'hsl(var(--ds-color-warning) / <alpha-value>)',
          danger: 'hsl(var(--ds-color-danger) / <alpha-value>)',
          info: 'hsl(var(--ds-color-info) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        'ds-sm': 'var(--ds-radius-sm)',
        'ds-md': 'var(--ds-radius-md)',
        'ds-lg': 'var(--ds-radius-lg)',
        'ds-xl': 'var(--ds-radius-xl)',
      },
      boxShadow: {
        'ds-sm': 'var(--ds-shadow-sm)',
        'ds-md': 'var(--ds-shadow-md)',
        'ds-lg': 'var(--ds-shadow-lg)',
      },
    },
  },
  plugins: [],
}
