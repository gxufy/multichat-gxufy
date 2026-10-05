import SitePage from '@/components/site/SitePage';

const PROFILES = [
  ['Twitch', 'https://twitch.tv/gxufy'],
  ['YouTube', 'https://youtube.com/@gxufy'],
  ['Kick', 'https://kick.com/gxufy'],
  ['TikTok', 'https://www.tiktok.com/@gxufy_'],
  ['Instagram', 'https://www.instagram.com/gxufy_/'],
  ['X', 'https://x.com/gxufy_'],
  ['GitHub', 'https://github.com/gxufy'],
  ['Link hub', 'https://solo.to/gxufy'],
] as const;

export default function ConnectPage() {
  return (
    <SitePage
      title="Socials & Contact | Gxufy 🕊️"
      heading="Socials & Contact"
      path="/connect"
      description="Official Gxufy links across Twitch, YouTube, Kick, TikTok, Instagram, X, GitHub, and the Gxufy link hub."
    >
      <section>
        <h2>Find Gxufy online</h2>
        <p>
          These profiles connect the Gxufy name across streaming, video, social,
          and development platforms.
        </p>
        <ul>
          {PROFILES.map(([label, href]) => (
            <li key={href}>
              <a href={href} target="_blank" rel="me noreferrer">{label}</a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Stream tools</h2>
        <p>
          The tools published at gxufy.com are built for creators who want clean
          multi-platform chat and viewer-count overlays without extra setup.
        </p>
        <p><a href="/multichat">Open MultiChat →</a></p>
      </section>
    </SitePage>
  );
}
