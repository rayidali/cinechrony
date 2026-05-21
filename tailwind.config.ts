import type {Config} from 'tailwindcss';

// Wrap a bare-oklch-component token so Tailwind can compose opacity
// modifiers (bg-x/50, border-x/30, …) via the <alpha-value> placeholder.
const ok = (name: string) => `oklch(var(${name}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // v2: Bricolage Grotesque is the UI default + display face;
        // Newsreader serif is reserved for prose (font-serif / .cc-lead);
        // Space Mono carries tabular data. `headline`/`body` are kept as
        // aliases so existing class usages don't break — both = Bricolage.
        sans: ['var(--font-headline)', 'system-ui', 'sans-serif'],
        headline: ['var(--font-headline)', 'system-ui', 'sans-serif'],
        body: ['var(--font-headline)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        background: ok('--background'),
        foreground: ok('--foreground'),
        card: {
          DEFAULT: ok('--card'),
          foreground: ok('--card-foreground'),
        },
        popover: {
          DEFAULT: ok('--popover'),
          foreground: ok('--popover-foreground'),
        },
        primary: {
          DEFAULT: ok('--primary'),
          foreground: ok('--primary-foreground'),
        },
        secondary: {
          DEFAULT: ok('--secondary'),
          foreground: ok('--secondary-foreground'),
        },
        muted: {
          DEFAULT: ok('--muted'),
          foreground: ok('--muted-foreground'),
        },
        accent: {
          DEFAULT: ok('--accent'),
          foreground: ok('--accent-foreground'),
        },
        destructive: {
          DEFAULT: ok('--destructive'),
          foreground: ok('--destructive-foreground'),
        },
        warning: {
          DEFAULT: ok('--warning'),
          foreground: ok('--warning-foreground'),
        },
        success: {
          DEFAULT: ok('--success'),
          foreground: ok('--success-foreground'),
        },
        border: ok('--border'),
        input: ok('--input'),
        ring: ok('--ring'),
        chart: {
          '1': ok('--chart-1'),
          '2': ok('--chart-2'),
          '3': ok('--chart-3'),
          '4': ok('--chart-4'),
          '5': ok('--chart-5'),
        },
        sidebar: {
          DEFAULT: ok('--sidebar-background'),
          foreground: ok('--sidebar-foreground'),
          primary: ok('--sidebar-primary'),
          'primary-foreground': ok('--sidebar-primary-foreground'),
          accent: ok('--sidebar-accent'),
          'accent-foreground': ok('--sidebar-accent-foreground'),
          border: ok('--sidebar-border'),
          ring: ok('--sidebar-ring'),
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        // v2 soft, magazine-y lifts. `stamp` is the FAB-only brutalist survivor.
        lift: 'var(--shadow-lift)',
        photo: 'var(--shadow-photo)',
        press: 'var(--shadow-press)',
        stamp: 'var(--shadow-stamp)',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
        'slide-up-from-bottom': {
          from: {
            transform: 'translateY(100%)',
          },
          to: {
            transform: 'translateY(0)',
          },
        },
        'slide-down-to-bottom': {
          from: {
            transform: 'translateY(0)',
          },
          to: {
            transform: 'translateY(100%)',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'accordion-up': 'accordion-up 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slide-up-from-bottom 0.36s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slide-down-to-bottom 0.22s ease-in',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
