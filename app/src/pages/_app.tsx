import Head from 'next/head';
import type { AppProps } from 'next/app';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta name="application-name" content="Gxufy 🕊️" />
        <meta property="og:site_name" content="Gxufy 🕊️" />
        <link rel="icon" type="image/svg+xml" href="/api/favicon?v=2" />
        <link rel="shortcut icon" type="image/svg+xml" href="/api/favicon?v=2" />
        <link rel="apple-touch-icon" href="/gxufy-avatar.gif" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
