/* Sunset notice for the old kickchat-gxufy.vercel.app deployment.
 * Renders nothing on the new domain / localhost. On the old domain:
 *  - landing: fixed top banner with redirect link
 *  - overlay (OBS): compact bottom notice, since there's no UI chrome
 */
import { useEffect, useState } from 'react';

const NEW_URL = 'https://multichat-gxufy.com';
const OLD_HOSTS = ['kickchat-gxufy.vercel.app', 'multichat-gxufy.vercel.app'];

export function useIsOldDomain(): boolean {
  const [old, setOld] = useState(false);
  useEffect(() => {
    setOld(OLD_HOSTS.includes(window.location.hostname));
  }, []);
  return old;
}

export function SunsetBanner({ variant }: { variant: 'landing' | 'overlay' }) {
  const isOld = useIsOldDomain();
  if (!isOld) return null;

  if (variant === 'overlay') {
    // OBS browser source: keep it readable but out of the chat area
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
        background: 'rgba(180,30,30,0.92)', color: '#fff',
        fontFamily: 'sans-serif', fontWeight: 700, fontSize: 14,
        padding: '6px 10px', textAlign: 'center', lineHeight: 1.4,
      }}>
        ⚠️ This site shuts down after December 31, 2026. Update your browser
        source URL at{' '}
        <a href={NEW_URL} style={{ color: '#ffe08a' }}>multichat-gxufy.com</a>
        {' '}— same overlay, new home, plus Twitch/YouTube/TikTok support.
      </div>
    );
  }

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10000,
      background: 'linear-gradient(90deg, #7a1414, #a32020)', color: '#fff',
      padding: '12px 18px', textAlign: 'center',
      fontSize: '0.95rem', lineHeight: 1.5, fontWeight: 600,
    }}>
      ⚠️ <strong>This website will be deleted after December 31, 2026.</strong>{' '}
      The overlay moved (and got Twitch, YouTube &amp; TikTok support!) —{' '}
      <a href={NEW_URL} style={{ color: '#ffe08a', fontWeight: 800 }}>
        go to multichat-gxufy.com →
      </a>
    </div>
  );
}
