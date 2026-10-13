import Head from 'next/head';
import ViewerCounterDisplay from '@/components/overlay/ViewerCounterDisplay';
import { sampleCounterStatuses } from '@/features/counter/samples';
import { DEFAULT_STYLE } from '@/lib/viewerCounterConfig';

const PREVIEW_STATUSES = sampleCounterStatuses();

export default function PoglyViewerCounterPreview() {
  return (
    <>
      <Head>
        <title>Gxufy Viewer Counter Preview</title>
        <meta name="robots" content="noindex,nofollow" />
        <style>{`
          html, body, #__next {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
            background: transparent;
          }
        `}</style>
      </Head>
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
          boxSizing: 'border-box',
        }}
      >
        <ViewerCounterDisplay
          statuses={PREVIEW_STATUSES}
          style={{ ...DEFAULT_STYLE, align: 'center' }}
        />
      </div>
    </>
  );
}
