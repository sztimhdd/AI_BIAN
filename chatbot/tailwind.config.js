/** @type {import('tailwindcss').Config} */

import { fontFamily as _fontFamily } from 'tailwindcss/defaultTheme';

import colors from 'tailwindcss/colors';

// These are deprecated, so we delete them to avoid warnings and so they are not used.
delete colors['lightBlue'];
delete colors['warmGray'];
delete colors['trueGray'];
delete colors['coolGray'];
delete colors['blueGray'];

const intensities = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const safeColors = ['indigo'];
const safeWidths = ['10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%'];

export const darkMode = 'class';
export const content = [
  './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
  './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  './src/app/**/*.{js,ts,jsx,tsx,mdx}',
];
export const theme = {
  extend: {
    fontFamily: {
      sans: [
        'Inter',
        'system-ui',
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ],
      serif: [
        '"Noto Serif"',
        'Georgia',
        'Cambria',
        '"Times New Roman"',
        'Times',
        'serif',
      ],
      mono: [
        'ui-monospace',
        'SFMono-Regular',
        'Menlo',
        'Monaco',
        'Consolas',
        '"Liberation Mono"',
        '"Courier New"',
        'monospace',
      ],
    },
    colors,
    transitionProperty: {
      height: 'height',
    },
    typography: (theme) => ({
      DEFAULT: {
        css: {
          color: theme('colors.gray.900'),
          a: {
            color: theme('colors.blue.600'),
            '&:hover': {
              color: theme('colors.blue.800'),
            },
          },
          maxWidth: '65ch',
        },
      },
      invert: {
        css: {
          color: theme('colors.gray.200'),
          a: {
            color: theme('colors.blue.400'),
            '&:hover': {
              color: theme('colors.blue.300'),
            },
          },
          strong: {
            color: theme('colors.gray.100'),
          },
          h1: {
            color: theme('colors.gray.100'),
          },
          h2: {
            color: theme('colors.gray.100'),
          },
          h3: {
            color: theme('colors.gray.100'),
          },
          h4: {
            color: theme('colors.gray.100'),
          },
          code: {
            color: theme('colors.gray.100'),
          },
          pre: {
            backgroundColor: theme('colors.gray.800'),
          },
          blockquote: {
            color: theme('colors.gray.300'),
          },
        },
      },
    }),
    backgroundImage: {
      'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
    },
    animation: {
      'bounce-slow': 'bounce 3s infinite',
      'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      'spin-slow': 'spin 3s linear infinite',
    },
    boxShadow: {
      'inner-lg': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
      'soft-xl': '0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 10px -5px rgba(0, 0, 0, 0.01)',
      'soft-2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.07)',
    },
  },
  screens: {
    sm: '640px',
    md: '1024px',
    lg: '1440px',
    xl: '1680px',
  },
};
import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';

export const plugins = [forms, typography];
export const safelist = [
  ...safeColors.flatMap((color) => intensities.map((intensity) => `bg-${color}-${intensity}`)),
  ...safeColors.flatMap((color) => intensities.map((intensity) => `hover:bg-${color}-${intensity}`)),
  ...safeColors.flatMap((color) => intensities.map((intensity) => `text-${color}-${intensity}`)),
  ...safeColors.flatMap((color) => intensities.map((intensity) => `hover:text-${color}-${intensity}`)),
  ...safeWidths.map((width) => `w-[${width}]`),
];
