import Head from 'next/head';
import type { AppProps } from 'next/app';
import '../styles/globals.css';

/* gxufy.com's homepage keeps the Gxufy avatar; every FlossChat page (overlay,
   generator, counter, support) shows the FlossChat logo in the browser tab. */
const GXUFY_ICON = { href: '/gxufy-avatar.gif', type: 'image/gif' };
const FLOSSCHAT_ICON = { href: '/flosschat-icon.png', type: 'image/png' };

export default function App({ Component, pageProps, router }: AppProps) {
  const icon = router?.pathname === '/' ? GXUFY_ICON : FLOSSCHAT_ICON;
  return (
    <>
      <Head>
        <meta name="application-name" content="Gxufy 🕊️" />
        <meta property="og:site_name" content="Gxufy 🕊️" />
        <link key="icon" rel="icon" type={icon.type} href={icon.href} />
        <link key="shortcut-icon" rel="shortcut icon" type={icon.type} href={icon.href} />
        <link key="apple-touch-icon" rel="apple-touch-icon" href={icon.href} />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
