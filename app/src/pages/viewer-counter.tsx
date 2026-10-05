import SitePage from '@/components/site/SitePage';

export default function ViewerCounterPage() {
  return (
    <SitePage
      title="Viewer Counter | Gxufy 🕊️"
      heading="Viewer Counter"
      path="/viewer-counter"
      description="A live OBS viewer counter for Kick, Twitch, YouTube, and TikTok with combined or separate totals, platform icons, Google Fonts, shadows, outlines, and transparent backgrounds."
    >
      <section>
        <h2>One viewer counter for every stream</h2>
        <p>
          Track the platforms you are live on in one clean browser source. You can
          combine the audience into one total or show each platform separately, and
          offline platforms disappear automatically.
        </p>
        <a className="cta" href="/multichat#viewer-counter">Open the viewer counter generator →</a>
      </section>

      <section>
        <h2>Built for OBS</h2>
        <ul>
          <li>Kick, Twitch, YouTube, and TikTok support.</li>
          <li>Combined or per-platform viewer totals.</li>
          <li>Optional platform icons and pill background.</li>
          <li>Google Fonts, text shadow, and outline controls.</li>
          <li>Transparent browser-source output.</li>
        </ul>
      </section>

      <section>
        <h2>Part of the Gxufy overlay toolkit</h2>
        <p>
          The viewer counter is generated beside MultiChat, so you can use the
          same channel names for chat and audience counts while keeping each as
          its own OBS browser source.
        </p>
        <p><a href="/multichat">Explore MultiChat →</a></p>
      </section>
    </SitePage>
  );
}
