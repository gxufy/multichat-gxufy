import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import BadgesDashboard from '@/components/badges/BadgesDashboard';
import { UI_FONT_SPECS, googleFontsImportCss } from '@/lib/overlayFonts';
import { supportPageEnabled } from '@/lib/supportPage';

const FONT_CSS = googleFontsImportCss(Object.values(UI_FONT_SPECS));

/* Same private-preview gate as /support until the supporter flow launches. */
export const getServerSideProps: GetServerSideProps = async () => {
  if (!supportPageEnabled()) return { notFound: true };
  return { props: {} };
};

export default function BadgesPage() {
  return (
    <>
      <Head>
        <title>Your badges | FlossChat</title>
        <meta name="robots" content="noindex,nofollow,noarchive" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <style dangerouslySetInnerHTML={{ __html: FONT_CSS }} />
      </Head>
      <style jsx global>{`
        html, body { margin: 0; background: #141418; }
      `}</style>
      <BadgesDashboard />
    </>
  );
}
