import Head from 'next/head';
import type {
  GetServerSideProps,
} from 'next';
import SupportCheckout, {
  type SupportCheckoutProps,
} from '@/components/support/SupportCheckout';
import {
  supportPageEnabled,
} from '@/lib/supportPage';

export {
  buildSupportBadgePreview,
  buildSupportUsernameStyle,
  type SupportBadgePreview,
} from '@/components/support/SupportCheckout';

type SupportPageProps = Pick<SupportCheckoutProps, 'checkoutReady'>;

export const getServerSideProps:
GetServerSideProps<SupportPageProps> = async () => {
  if (!supportPageEnabled()) {
    return {
      notFound: true,
    };
  }

  const { checkoutDeps } = await import('@/lib/server/supportCheckout');

  return {
    props: {
      checkoutReady: checkoutDeps() !== null,
    },
  };
};

export default function SupportPage({
  checkoutReady = false,
}: SupportPageProps = {}) {
  return (
    <>
      <Head>
        <title>
          Support Gxufy | Private Preview
        </title>
        <meta
          name="robots"
          content="noindex,nofollow,noarchive"
        />
        <meta
          name="description"
          content="Private preview of the Gxufy supporter flow."
        />
      </Head>
      <style jsx global>{`
        html,
        body {
          min-height: 100%;
          margin: 0;
          background: #0b0b0d;
        }
      `}</style>
      <main>
        <SupportCheckout checkoutReady={checkoutReady} />
      </main>
    </>
  );
}
