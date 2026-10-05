/* /tools/multichat and /tools/counter — retired generator addresses.
 *
 * These hosted the three-column generic workspace. That direction was reversed:
 * the revamped original Classic generator at /multichat is now the only
 * generator, and it embeds the Viewer Counter as a companion panel rather than
 * giving it a page of its own.
 *
 * Both paths stay as redirects, because they were linked from the homepage and
 * are in the OAuth return allowlist for authorizations that were already in
 * flight when this shipped. Each forwards to where its tool now lives:
 *
 *   /tools/multichat → /multichat
 *   /tools/counter   → /multichat#viewer-counter
 *
 * An unregistered id is still a genuine 404 rather than a redirect, so
 * /tools/unknown does not quietly become the generator.
 *
 * These are the only two destinations, so they come from a build-time prop
 * derived from the tool registry rather than from router.query — the redirect can
 * then start on the first client render instead of waiting for the router.
 */
import Head from 'next/head';
import type { GetStaticPaths, GetStaticProps } from 'next';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { TOOL_IDS, findTool } from '@/features/registry';
import {
  CANONICAL_COUNTER_ROUTE,
  CANONICAL_MULTICHAT_ROUTE,
} from '@/lib/multichatRouting';

type Props = { destination: string };

/**
 * Whether a fragment is an OAuth connection payload rather than an anchor.
 *
 * `/tools/multichat` is still in the OAuth return allowlist, because an
 * authorization begun before the deploy that retired it will present that
 * destination, and the callback delivers the connection id in the URL fragment. A
 * redirect that dropped it would silently discard the connection the user just
 * authorized. So a payload fragment replaces the destination's own anchor and is
 * carried across; a plain anchor is not, since the destination already names the
 * section it wants.
 *
 * Detected by shape — a payload is `key=value` pairs — rather than by matching the
 * parameter name, so nothing here needs to know what the fields are called. The
 * value is never parsed, logged, or turned into a query parameter.
 */
function isConnectionFragment(hash: string): boolean {
  return hash.replace(/^#/, '').includes('=');
}

export const getStaticPaths: GetStaticPaths = () => ({
  paths: TOOL_IDS.map((id) => ({ params: { tool: id } })),
  fallback: false,
});

/**
 * Where each retired tool page now sends visitors.
 *
 * Keyed by registered tool id, so a tool added to the registry later that has no
 * entry here fails the lookup below and 404s rather than silently redirecting to
 * the chat generator.
 */
const DESTINATION: Readonly<Record<string, string>> = {
  multichat: CANONICAL_MULTICHAT_ROUTE,
  counter: CANONICAL_COUNTER_ROUTE,
};

export const getStaticProps: GetStaticProps<Props> = ({ params }) => {
  const toolId = typeof params?.tool === 'string' ? params.tool : '';
  if (!findTool(toolId)) return { notFound: true };

  const destination = DESTINATION[toolId];
  if (!destination) return { notFound: true };

  return { props: { destination } };
};

export default function RetiredToolPage({ destination }: Props) {
  const router = useRouter();

  /* `null` until the client has looked. A fragment is never sent to the server
     and never appears in router.query, so this is the only way to see one — and
     reading window.location during render would be a hydration mismatch. */
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    setHash(window.location.hash);
  }, []);

  /* Guards against a doubled replace — Strict Mode double-invokes effects in
     development. The destination is stored rather than a boolean so a genuinely
     different target would still be honoured. */
  const redirected = useRef('');

  useEffect(() => {
    /* Wait for the fragment read. Forwarding first is the bug: the destination
       would be built without a connection that was present. */
    if (hash === null) return;

    const target = isConnectionFragment(hash)
      ? `${CANONICAL_MULTICHAT_ROUTE}${hash}`
      : destination;

    if (redirected.current === target) return;
    redirected.current = target;
    /* `replace`, not `push`, so Back returns to wherever the visitor came from
       rather than bouncing through this path again — and so a fragment-bearing
       intermediate URL is not left in history. */
    void router.replace(target);
    /* `router` is deliberately absent: its identity changes on every navigation
       and re-running this would re-issue the same replace. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, hash]);

  return (
    <>
      <Head>
        <title>multichat-gxufy</title>
        {/* A redirect stub, not content. */}
        <meta name="robots" content="noindex" />
      </Head>
      {/* Rendered rather than returning null so a visitor whose JavaScript has
          not run yet still gets a working way forward instead of a blank page. */}
      <p style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        This page has moved. <a href={destination}>Continue</a>.
      </p>
    </>
  );
}
