/* /classic/multichat — retired address of the original generator.
 *
 * The original Classic generator is no longer a separate page: it *is* the
 * generator now, revamped and served at a channel-less /multichat. This route
 * stays only so links and bookmarks to it keep working, and it forwards.
 *
 * Why the fragment has to be carried across the forward, and cannot simply be
 * dropped: this path is still in the OAuth return allowlist, because an
 * authorization started before the deploy comes back to whatever `returnTo` it
 * recorded. The callback delivers the connection id in the URL fragment, and a
 * fragment is not in `router.query` — it only exists in `window.location.hash`.
 * A forward that ignored it would silently discard the connection the user just
 * authorized, and they would land on the generator with nothing to show for it.
 * So the hash is read client-side and appended to the destination.
 *
 * The fragment is never logged, never turned into a query parameter, and never
 * inspected here beyond being passed along.
 */
import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { CANONICAL_MULTICHAT_ROUTE } from '@/lib/multichatRouting';

export default function ClassicMultichatPage() {
  const router = useRouter();

  /* `null` until the client has looked. Read from an effect, not during render:
     `window` does not exist on the server pass, and reading it during render
     would produce a hydration mismatch. */
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    setHash(window.location.hash);
  }, []);

  /* Guards against issuing the same replace twice — Strict Mode double-invokes
     effects in development. The destination is stored rather than a boolean, so
     a genuinely different target would still be honoured. */
  const redirected = useRef('');

  useEffect(() => {
    /* Wait for the fragment to have been read. Forwarding before then is the
       bug: the destination would be built without it. */
    if (hash === null) return;

    const target = `${CANONICAL_MULTICHAT_ROUTE}${hash}`;
    if (redirected.current === target) return;
    redirected.current = target;

    /* `replace`, not `push`: Back should return to wherever the user came from
       rather than bouncing through this path again, and the fragment-bearing
       intermediate URL should not be left in history. */
    void router.replace(target);
    /* `router` is deliberately absent: its identity changes on every navigation
       and re-running this would re-issue the same replace. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  return (
    <>
      <Head>
        <title>multichat-gxufy</title>
        {/* A redirect stub, not content. */}
        <meta name="robots" content="noindex" />
      </Head>
      {/* Rendered rather than returning null so a visitor whose JavaScript has
          not run yet, or who lands here with the redirect somehow blocked, still
          gets a working way forward instead of a blank page. */}
      <p style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        The generator has moved. <a href={CANONICAL_MULTICHAT_ROUTE}>Continue</a>
        .
      </p>
    </>
  );
}
