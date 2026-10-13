/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./pages/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}', './app/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /* Generator-workspace surface tokens. Used only by components under
         components/workspace and components/ui — no overlay rendering CSS
         reads these, and no existing stylesheet was changed to adopt them. */
      colors: {
        'ws-bg': '#101012',
        'ws-surface': '#17171a',
        'ws-border': '#2a2a30',
        'ws-control': '#22222a',
        'ws-control-hover': '#2c2c36',
        'ws-text': '#ededf0',
        'ws-muted': '#9a9aa5',
        'ws-accent': '#6d4aff',
        'ws-accent-hover': '#7f60ff',
        'ws-ring': '#8b6cff',
        'ws-danger': '#f87171',
        /* Raised surface for nested groups inside a card — the classic
           generator's --card-2, which is what stops a card-inside-a-card from
           reading as one flat slab. */
        'ws-raised': '#20202a',
        /* Platform brand colors, from lib/render's PROVIDERS. Duplicated as
           Tailwind tokens because channel chrome is styled at build time while
           PROVIDERS is consumed at render time; the parity test in
           tests/unit/platformChrome.test.ts asserts the two agree. */
        'ws-kick': '#53fc18',
        'ws-twitch': '#9147ff',
        'ws-youtube': '#ff0000',
        'ws-tiktok': '#00f2ea',
      },
      boxShadow: {
        /* The classic generator's --shadow. Chunky and doubled: a wide soft
           ambient plus a tight contact shadow, which is what separates its cards
           from the background instead of relying on the border alone. */
        'ws-card': '0 4px 24px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.5)',
      },
      backgroundImage: {
        /* The accent glow behind the classic generator's header. */
        'ws-glow':
          'radial-gradient(ellipse 900px 420px at 50% -80px, rgba(109,74,255,0.10), transparent)',
      },
      keyframes: {
        slide: { '0%': { transform: 'translateX(-100%)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
        fade: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      },
      animation: {
        slide: 'slide 0.2s ease-in-out',
        fade: 'fade 0.2s ease-in-out',
      },
      textShadow: {
        sm: '0 1px 2px #000, 0 0 1px #000, 0 0 1px #000, 0 0 1px #000, 0 0 1px #000',
        md: '0 1px 3px #000, 0 0 1.5px #000, 0 0 1.5px #000, 0 0 1.5px #000, 0 0 1.5px #000',
        lg: '0 1px 4px #000, 0 0 2px #000, 0 0 2px #000, 0 0 2px #000, 0 0 2px #000',
      },
    },
  },
  plugins: [
    function ({ matchUtilities, addVariant, theme }) {
      // Apply text-shadow only in dark mode, like the original dark:text-shadow-* classes
      addVariant('dark-shadow', ':is(.dark &)');
      matchUtilities(
        { 'text-shadow': (value) => ({ textShadow: value }) },
        { values: theme('textShadow') }
      );
    },
  ],
};
