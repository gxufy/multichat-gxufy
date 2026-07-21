import { useState, useEffect } from 'react';
import Head from 'next/head';
import { sourceTag } from '../lib/render';
import type { Platform } from '../lib/types';

const FONTS: [string, string, string][] = [
  ['baloo',       'Baloo Tammudu',          "'Baloo Tammudu 2', cursive"],
  ['segoe',       'Segoe UI (Chatterino)',   "'Segoe UI', sans-serif"],
  ['roboto',      'Roboto',                 "'Roboto', sans-serif"],
  ['lato',        'Lato',                   "'Lato', sans-serif"],
  ['noto',        'Noto Sans',              "'Noto Sans JP', sans-serif"],
  ['sourcecode',  'Source Code Pro',        "'Source Code Pro', monospace"],
  ['impact',      'Impact',                 "'Impact', sans-serif"],
  ['comfortaa',   'Comfortaa',              "'Comfortaa', cursive"],
  ['dancing',     'Dancing Script',         "'Dancing Script', cursive"],
  ['indieflower', 'Indie Flower',           "'Indie Flower', cursive"],
  ['opensans',    'Open Sans',              "'Open Sans', sans-serif"],
  ['alsina',      'Alsina (Vsauce)',         "Alsina, cursive"],
];

const PSZ = {
  small:  { fs:'20px', lh:'30px', bh:'16px', bw:'16px', bmr:'2px', bmb:'3px', blmr:'3px', cmr:'8px',  eh:'25px', ew:'75px'  },
  medium: { fs:'34px', lh:'55px', bh:'28px', bw:'28px', bmr:'4px', bmb:'6px', blmr:'6px', cmr:'14px', eh:'42px', ew:'128px' },
  large:  { fs:'48px', lh:'75px', bh:'40px', bw:'40px', bmr:'5px', bmb:'8px', blmr:'8px', cmr:'20px', eh:'60px', ew:'180px' },
} as const;
type SzKey = keyof typeof PSZ;

// Preview messages — one per platform, real badge art per platform
const TW_BADGE = (uuid: string) => `https://static-cdn.jtvnw.net/badges/v1/${uuid}/2`;
const YT_MOD = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#3ea6ff"><path d="M12 2 4 5.5V12c0 4.7 3.4 8.6 8 10 4.6-1.4 8-5.3 8-10V5.5Zm5.3 6.1-6.5 6.9-3.6-3.4 1.2-1.3 2.4 2.2 5.3-5.7Z"/></svg>');
const YT_VERIFIED = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#999999"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.5-3.9-3.9 1.4-1.4 2.5 2.5 5.9-5.9 1.4 1.4Z"/></svg>');

const PREV_MSGS: Array<{
  platform: Platform; color: string; paint: string | null; user: string;
  badges: { src: string; alt: string }[];
  msg: string; emotes: { src: string; alt: string }[];
}> = [
  {
    platform: 'kick',
    color: '#FF4B6E',
    paint: 'linear-gradient(135deg, #FF4B6E, #ff8c69)',
    user: 'AdinRoss',
    badges: [
      { src: '/badges/gift_200-249.svg', alt: 'subGifter200' },
      { src: '/badges/og.svg', alt: 'og' },
      { src: '/badges/verified.svg', alt: 'verified' },
    ],
    msg: "Don't forget to go to brandriskpromotions.com! ",
    emotes: [{ src: 'https://cdn.7tv.app/emote/01GNQNADZG0008EC7XVFGMTRNY/2x.webp', alt: 'LOL' }],
  },
  {
    platform: 'tiktok',
    color: '#7afcff',
    paint: null,
    user: 'Silky',
    badges: [
      { src: 'https://p16-webcast.tiktokcdn.com/webcast-sg/new_top_gifter_version_2.png~tplv-obj.image', alt: 'topGifter' },
      { src: '/badges/moderator.svg', alt: 'moderator' },
    ],
    msg: "I'm Flossy's Finest! ",
    emotes: [{ src: 'https://cdn.7tv.app/emote/01JQMR41S2EDRM9K6Q78B40F1S/4x.avif', alt: 'Flossy' }],
  },
  {
    platform: 'kick',
    color: '#53fc18',
    paint: 'linear-gradient(90deg, #53fc18, #00e5ff, #53fc18)',
    user: 'Gxufy',
    badges: [
      { src: '/badges/gift_25-99.svg', alt: 'subGifter50' },
      { src: '/badges/moderator.svg', alt: 'moderator' },
      { src: '/badges/sidekick.svg', alt: 'sidekick' },
    ],
    msg: 'how do you like my new multichat overlay? ',
    emotes: [{ src: 'https://cdn.7tv.app/emote/01H3HH5M180005101ADVY57FSB/2x.webp', alt: 'gg' }],
  },
  {
    platform: 'twitch',
    color: '#D399FF',
    paint: 'linear-gradient(135deg, #D399FF, #7c3aed, #D399FF)',
    user: 'KaiCenat',
    badges: [
      { src: TW_BADGE('5527c58c-fb7d-422d-b71b-f309dcb85cc1'), alt: 'broadcaster' },
      { src: TW_BADGE('5d9f2208-5dd8-11e7-8513-2ff4adfae661'), alt: 'subscriber' },
      { src: TW_BADGE('d12a2e27-16f6-41d0-ab77-b780518f00a3'), alt: 'partner' },
    ],
    msg: "You've been invited to Streamer's University 2027! ",
    emotes: [{ src: 'https://cdn.7tv.app/emote/01K7QZQ23KNR9E6ERTDEE3E9GQ/4x.avif', alt: 'invited' }],
  },
  {
    platform: 'youtube',
    color: '#00BFFF',
    paint: 'linear-gradient(90deg, #00BFFF, #0080ff, #00BFFF)',
    user: 'FazeRug',
    badges: [
      { src: YT_VERIFIED, alt: 'verified' },
      { src: YT_MOD, alt: 'moderator' },
    ],
    msg: "I've been tuning in to your streams. Keep up the good work! ",
    emotes: [{ src: 'https://cdn.7tv.app/emote/01GZ2CTDQ000093EMR4AKWQ462/2x.webp', alt: 'lebronArrive' }],
  },
];

export default function LandingPage() {
  const [channel,     setChannel]     = useState('');
  const [twitch,      setTwitch]      = useState('');
  const [youtube,     setYoutube]     = useState('');
  const [tiktok,      setTiktok]      = useState('');
  const [sevenTVE,    setSevenTVE]    = useState(true);
  const [sevenTVC,    setSevenTVC]    = useState(true);
  const [textSize,    setTextSize]    = useState('medium');
  const [font,        setFont]        = useState('opensans');
  const [textShadow,  setTextShadow]  = useState('small');
  const [stroke,      setStroke]      = useState('none');
  const [animation,   setAnimation]   = useState('slide');
  const [fade,        setFade]        = useState('30');
  const [fadeBool,    setFadeBool]    = useState(true);
  const [showPin,     setShowPin]     = useState(true);
  const [platformIcons, setPlatformIcons] = useState(true);
  const [vcCombined,  setVcCombined]  = useState('true');
  const [vcFont,      setVcFont]      = useState('dejavu');
  const [vcIcons,     setVcIcons]     = useState('true');
  const [vcBg,        setVcBg]        = useState('true');
  const [copiedCounter, setCopiedCounter] = useState(false);
  const [emoteScale,  setEmoteScale]  = useState('');
  const [smallCaps,   setSmallCaps]   = useState(false);
  const [nlAfterName, setNlAfterName] = useState(false);
  const [hideNames,   setHideNames]   = useState(false);
  const [botNames,    setBotNames]    = useState('');
  const [copied,      setCopied]      = useState(false);
  const [previewWhite, setPreviewWhite] = useState(false);
  const [baseUrl,     setBaseUrl]     = useState('https://multichat-gxufy.com');

  useEffect(() => { setBaseUrl(window.location.origin); }, []);

  const params = new URLSearchParams({
    ...(channel.trim() ? { kick: channel.trim() } : {}),
    ...(twitch.trim()  ? { twitch: twitch.trim().replace(/^@/, '') } : {}),
    ...(youtube.trim() ? { youtube: youtube.trim().replace(/^@/, '') } : {}),
    ...(tiktok.trim()  ? { tiktok: tiktok.trim().replace(/^@/, '') } : {}),
    // no platform filled → placeholder so the URL preview stays valid
    ...(!channel.trim() && !twitch.trim() && !youtube.trim() && !tiktok.trim() ? { kick: 'yourchannel' } : {}),
    sevenTVEmotesEnabled:    String(sevenTVE),
    sevenTVCosmeticsEnabled: String(sevenTVC),
    textSize, font, textShadow, stroke, animation,
    ...(fadeBool && fade !== '' ? { fade } : {}),
    showPinEnabled:        String(showPin),
    ...(platformIcons ? {} : { sourceTag: 'none' }),
    ...(emoteScale !== '' ? { emoteScale } : {}),
    smallCaps:   String(smallCaps),
    nlAfterName: String(nlAfterName),
    hideNames:   String(hideNames),
    ...(botNames.trim() ? { botNames: botNames.trim() } : {}),
  });
  const overlayUrl = `${baseUrl}/?${params.toString()}`;

  const counterParams = new URLSearchParams({
    ...(channel.trim() ? { kick: channel.trim() } : {}),
    ...(twitch.trim()  ? { twitch: twitch.trim().replace(/^@/, '') } : {}),
    ...(youtube.trim() ? { youtube: youtube.trim().replace(/^@/, '') } : {}),
    ...(tiktok.trim()  ? { tiktok: tiktok.trim().replace(/^@/, '') } : {}),
    combined: vcCombined,
    font: vcFont,
    icons: vcIcons,
    bg: vcBg,
    textSize, textShadow, stroke,
  });
  const counterUrl = `${baseUrl}/counter?${counterParams.toString()}`;

  const copyCounter = () => {
    navigator.clipboard.writeText(counterUrl);
    setCopiedCounter(true);
    setTimeout(() => setCopiedCounter(false), 2000);
  };

  const copy = () => {
    navigator.clipboard.writeText(overlayUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fontCSS = FONTS.find(([v]) => v === font)?.[2] ?? "'Noto Sans JP', sans-serif";
  const psz     = PSZ[(textSize as SzKey)] ?? PSZ.medium;

  const pFilter =
    textShadow === 'small'  ? 'drop-shadow(2px 2px 0.2rem black)'  :
    textShadow === 'medium' ? 'drop-shadow(2px 2px 0.35rem black)' :
    textShadow === 'large'  ? 'drop-shadow(2px 2px 0.5rem black)'  : '';
  const pStroke =
    stroke === 'thin'    ? '1px black' :
    stroke === 'medium'  ? '2px black' :
    stroke === 'thick'   ? '3px black' :
    stroke === 'thicker' ? '4px black' : '';

  const badgeSize = parseInt(psz.bw);
  const emoteSize = parseInt(psz.eh);

  return (
    <>
      <Head>
        <title>multichat-gxufy | Kick · Twitch · YouTube · TikTok Chat Overlay</title>
        <meta name="description" content="Free multi-platform chat overlay for OBS by gxufy — Kick, Twitch, YouTube & TikTok in one browser source. 7TV/BTTV/FFZ emotes, real badges, name-paints, pins. No login required." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Baloo+Tammudu+2:wght@400;500;600;700;800&family=Comfortaa:wght@300;400;500;600;700&family=Dancing+Script:wght@400;500;600;700&family=Indie+Flower&family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,400&family=Noto+Sans+JP:wght@100;300;400;500;700;900&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,400&family=Source+Code+Pro:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,900;1,400&display=swap" rel="stylesheet" />
        <style>{`@font-face{font-family:Alsina;src:url(https://chatis.is2511.com/v2/styles/Alsina_Ultrajada.ttf);}`}</style>
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #1a1a1a; color: #d8d8d8; font-family: 'Noto Sans JP', system-ui, sans-serif; font-size: 16px; }
        a { color: #4a84fa; } a:hover { color: #6d9dff; }
        .page { max-width: 860px; margin: 0 auto; padding: 0 20px 60px; }

        /* Header */
        header { display: flex; flex-direction: column; align-items: center; padding: 0 0 20px; margin-bottom: 24px; border-bottom: 2px solid #4a84fa; gap: 8px; }
        /* logo hugs the top; title overlaps up into its lower bounds */
        .header-logo { height: 400px; width: auto; margin-top: -60px; margin-bottom: -120px; }
        @keyframes ckSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .header-title { font-size: 2.4rem; font-weight: 800; color: #fff; margin: 0; letter-spacing: -.03em; position: relative; z-index: 1; }
        .header-sub { font-size: 1rem; font-weight: 400; color: #4a84fa; margin: 0; }
        .platform-row { display: flex; gap: 8px; margin-top: 2px; }
        .platform-chip { font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; padding: 2px 10px; border-radius: 5px; }
        .header-blurb { max-width: 560px; text-align: center; color: #909090; font-size: 0.85rem; line-height: 1.55; margin: 6px 0 0; }

        /* Commands */
        .commands-section { margin-bottom: 24px; }
        .section-title { font-size: 0.82rem; color: #4a84fa; font-weight: 700; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .08em; }
        .cmd-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; }
        .cmd-table th { text-align: left; color: #4a84fa; font-weight: 600; padding: 4px 10px 6px; border-bottom: 1px solid #333; }
        .cmd-table td { padding: 5px 10px; color: #a0a0a0; border-bottom: 1px solid #252525; vertical-align: top; }
        .cmd-table td:first-child { color: #4a84fa; font-family: 'Roboto Mono', monospace; white-space: nowrap; font-size: 0.72rem; }
        .cmd-table tr:last-child td { border-bottom: none; }
        .cmd-access { font-size: 0.7rem; color: #555; }

        /* Form */
        form[name="generator"] { background: #232323; border: 1px solid #4a84fa; border-radius: 10px; padding: 24px 24px 18px; margin-bottom: 20px; }
        .form_row.center { display: flex; justify-content: center; margin-bottom: 16px; }
        .form_row.center input[type=text] { width: 100%; max-width: 360px; text-align: center; font-size: 1.1rem; padding: 10px 16px; }
        .platform-inputs { gap: 10px; flex-wrap: wrap; }
        .platform-input { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; min-width: 150px; }
        .platform-input input[type=text] { max-width: none; font-size: 0.95rem; padding: 8px 12px; }
        .platform-tag { font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; padding: 1px 8px; border-radius: 4px; }
        .kick-tag { color: #53fc18; border: 1px solid #53fc18; }
        .tw-tag { color: #9146FF; border: 1px solid #9146FF; }
        .yt-tag { color: #ff4444; border: 1px solid #ff4444; }
        .tt-tag { color: #25F4EE; border: 1px solid #25F4EE; }
        .form_table { display: flex; gap: 0; margin-bottom: 14px; }
        .form_col { flex: 1; }
        .form_col:first-child { border-right: 1px solid #2e2e2e; padding-right: 24px; }
        .form_col:last-child { padding-left: 24px; }
        .form_row { display: flex; align-items: center; margin-bottom: 11px; gap: 8px; }
        .form_row.left { justify-content: flex-start; }

        input[type=text], input[type=number], select { background: #2e2e2e; border: 1px solid #3a3a3a; border-radius: 5px; color: #d8d8d8; padding: 5px 10px; font-size: 0.87rem; font-family: inherit; outline: none; transition: border-color .15s; }
        input[type=text]:focus, select:focus { border-color: #4a84fa; }
        select option { background: #232323; }
        input[type=text].short { width: 52px; }
        label { font-size: 0.87rem; color: #a0a0a0; cursor: pointer; user-select: none; }
        label abbr { text-decoration: underline dotted; cursor: help; }

        /* Toggles */
        .toggle-wrap { display: flex; align-items: center; gap: 8px; justify-content: flex-end; margin-bottom: 11px; }
        .toggle-wrap > label:first-child { font-size: 0.87rem; color: #a0a0a0; cursor: pointer; user-select: none; order: -1; flex: 1; text-align: right; }
        .toggle { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .toggle-slider { position: absolute; inset: 0; background: #3a3a3a; border-radius: 20px; cursor: pointer; transition: background .2s; }
        .toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: #888; border-radius: 50%; transition: transform .2s, background .2s; }
        .toggle input:checked + .toggle-slider { background: #12234d; }
        .toggle input:checked + .toggle-slider::before { transform: translateX(16px); background: #4a84fa; }

        /* Preview */
        #submit_container { display: flex; flex-direction: column; gap: 0; margin-top: 14px; }
        .preview-wrap { width: 100%; }
        .preview-label { font-size: 0.78rem; color: #666; margin-bottom: 5px; display: flex; align-items: center; gap: 6px; }
        .preview-label button { background: none; border: 1px solid #444; border-radius: 4px; color: #888; font-size: 0.75rem; padding: 1px 7px; cursor: pointer; transition: border-color .15s, color .15s; }
        .preview-label button:hover { border-color: #4a84fa; color: #4a84fa; }
        #example { border: 1px solid #444; border-radius: 6px; overflow: hidden; transition: background .2s; }
        #example.white { background: #3a3a3a; }
        #example.checkered { background: repeating-conic-gradient(#1e1e1e 0% 25%, #171717 0% 50%) 0 0 / 16px 16px; }
        .example-inner { width: calc(100% - 20px); padding: 10px; word-break: break-word; font-weight: 800; color: white; }


        input[type=submit] { background: #4a84fa; color: #fff; border: none; border-radius: 7px; font-size: 1rem; font-weight: 800; padding: 12px 28px; cursor: pointer; font-family: inherit; transition: background .15s, transform .1s; align-self: flex-end; letter-spacing: -.01em; }
        input[type=submit]:hover { background: #6d9dff; transform: translateY(-1px); }
        input[type=submit]:active { transform: translateY(0); }

        /* URL result */
        #result { margin-bottom: 24px; }
        .url-box { display: flex; gap: 8px; align-items: stretch; }
        .url-code { flex: 1; background: #111; border: 1px solid #4a84fa; border-radius: 5px; padding: 10px 12px; font-family: 'Roboto Mono', monospace; font-size: 0.7rem; color: #4a84fa; word-break: break-all; line-height: 1.7; }
        .url-copy { flex-shrink: 0; background: #4a84fa; color: #fff; border: none; border-radius: 5px; font-weight: 800; font-size: 0.85rem; padding: 0 20px; cursor: pointer; transition: background .15s; font-family: inherit; }
        .url-copy.ok { background: #6d9dff; }
        .url-actions { display: flex; gap: 10px; margin-top: 8px; align-items: center; flex-wrap: wrap; }
        .url-newtab { font-size: 0.82rem; color: #4a84fa; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #4a84fa; border-radius: 5px; padding: 5px 12px; transition: background .15s; }
        .url-newtab:hover { background: rgba(74,132,250,0.1); color: #6d9dff; }
        #result > p { color: #555; font-size: 0.79rem; margin: 6px 0 0; }

        /* Setup */
        .setup-section { margin-bottom: 32px; }
        .steps { list-style: none; padding: 0; margin: 0; counter-reset: s; }
        .steps li { counter-increment: s; display: flex; gap: 10px; align-items: flex-start; margin-bottom: 9px; font-size: 0.87rem; color: #909090; line-height: 1.5; }
        .steps li::before { content: counter(s); background: #232323; border: 1px solid #4a84fa; border-radius: 50%; min-width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; color: #4a84fa; flex-shrink: 0; margin-top: 1px; }
        .steps li strong { color: #d8d8d8; }

        /* Footer */
        footer { border-top: 1px solid #252525; padding: 20px 0; text-align: center; font-size: 0.79rem; color: #444; margin-top: 20px; }
        footer p { margin: 4px 0; }
        footer a { color: #4a84fa; }
      `}</style>

      <div className="page">

        {/* Header */}
        <header>
          <img src="/tpl.webp" alt="multichat" className="header-logo" />
          <h1 className="header-title">multichat-gxufy</h1>
          <p className="header-sub">One overlay for Kick · Twitch · YouTube · TikTok — no login, no OAuth</p>
          <div className="platform-row">
            <span className="platform-chip kick-tag">Kick</span>
            <span className="platform-chip tw-tag">Twitch</span>
            <span className="platform-chip yt-tag">YouTube</span>
            <span className="platform-chip tt-tag">TikTok</span>
          </div>
          <p className="header-blurb">
            Combine any (or all) of your chats into a single OBS browser source.
            7TV / BTTV / FFZ emotes, real platform badges, name paints, pinned messages,
            gifts &amp; Super Chats — everything just works with a channel name.
          </p>
        </header>

        {/* Commands */}
        <div className="commands-section">
          <p className="section-title">Chat Commands <span style={{color:'#666', textTransform:'none', letterSpacing:0}}>— work from any connected platform&rsquo;s chat (mods &amp; broadcaster)</span></p>
          <table className="cmd-table">
            <thead><tr><th>Command</th><th>Description</th><th>Access</th></tr></thead>
            <tbody>
              <tr><td>!multichat ping</td><td>Shows a &ldquo;Pong!&rdquo; notification on screen</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat reload</td><td>Reloads the browser source</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat stop</td><td>Clears all active overlays</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat show / hide</td><td>Shows or hides the chat</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat refresh emotes</td><td>Reloads 7TV/BTTV/FFZ emotes without a page refresh</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat img [url or emote] -t [sec] -o [opacity]</td><td>Fullscreen image or emote (e.g. GIGACHAD). Use <code style={{color:'#4a84fa'}}>img clear</code> to dismiss</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat yt [url or preset] -t [sec] -m</td><td>Fullscreen YouTube video. Presets: bruh, vine-boom, rickroll, dc-ping, win-error. Add <code style={{color:'#4a84fa'}}>-m</code> to mute</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat tts [message]</td><td>Text-to-speech using the system voice built into OBS</td><td className="cmd-access">Mod+</td></tr>
            </tbody>
          </table>
          <p style={{ color:'#555', fontSize:'0.74rem', margin:'6px 0 0' }}><code style={{color:'#4a84fa'}}>!kickchat</code> still works as an alias for existing setups.</p>
        </div>

        {/* Generator form */}
        <form name="generator" onSubmit={e => { e.preventDefault(); copy(); }}>

          <div className="form_row center platform-inputs">
            <div className="platform-input">
              <span className="platform-tag kick-tag">Kick</span>
              <input type="text" name="channel" placeholder="Channel name"
                value={channel} onChange={e => setChannel(e.target.value)} />
            </div>
            <div className="platform-input">
              <span className="platform-tag tw-tag">Twitch</span>
              <input type="text" name="twitch" placeholder="Channel name"
                value={twitch} onChange={e => setTwitch(e.target.value)} />
            </div>
            <div className="platform-input">
              <span className="platform-tag yt-tag">YouTube</span>
              <input type="text" name="youtube" placeholder="@handle"
                value={youtube} onChange={e => setYoutube(e.target.value)} />
            </div>
            <div className="platform-input">
              <span className="platform-tag tt-tag">TikTok</span>
              <input type="text" name="tiktok" placeholder="@username"
                value={tiktok} onChange={e => setTiktok(e.target.value)} />
            </div>
          </div>
          <p style={{ textAlign:'center', color:'#666', fontSize:'0.78rem', margin:'-6px 0 16px' }}>
            Fill in any one — or combine platforms into a single overlay. No login needed.
          </p>

          <div className="form_table">
            {/* Left — selects */}
            <div className="form_col">
              <div className="form_row left">
                <select value={textSize} onChange={e => setTextSize(e.target.value)}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
                <label>Size</label>
              </div>
              <div className="form_row left">
                <select value={font} onChange={e => setFont(e.target.value)} style={{ fontFamily: fontCSS }}>
                  {FONTS.map(([v, label, css]) => (
                    <option key={v} value={v} style={{ fontFamily: css }}>{label}</option>
                  ))}
                </select>
                <label>Font</label>
              </div>
              <div className="form_row left">
                <select value={stroke} onChange={e => setStroke(e.target.value)}>
                  <option value="none">Off</option>
                  <option value="thin">Thin</option>
                  <option value="medium">Medium</option>
                  <option value="thick">Thick</option>
                  <option value="thicker">Thicker</option>
                </select>
                <label>Stroke</label>
              </div>
              <div className="form_row left">
                <select value={textShadow} onChange={e => setTextShadow(e.target.value)}>
                  <option value="none">Off</option>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
                <label>Shadow</label>
              </div>
              <div className="form_row left">
                <select value={animation} onChange={e => setAnimation(e.target.value)}>
                  <option value="none">None</option>
                  <option value="slide">Slide</option>
                  <option value="fade">Fade in</option>
                </select>
                <label>Animation</label>
              </div>
              <div className="form_row left">
                <input type="text" placeholder="1.0" style={{ width: 80 }}
                  value={emoteScale} onChange={e => setEmoteScale(e.target.value)} />
                <label>Emote scale (0–3)</label>
              </div>
            </div>

            {/* Right — toggles */}
            <div className="form_col">
              <div className="toggle-wrap">
                <label>7TV Emotes</label>
                <label className="toggle">
                  <input type="checkbox" checked={sevenTVE} onChange={e => setSevenTVE(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="toggle-wrap">
                <label>7TV Cosmetics</label>
                <label className="toggle">
                  <input type="checkbox" checked={sevenTVC} onChange={e => setSevenTVC(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="toggle-wrap">
                <label style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6, flex:1 }}>
                  Fade old messages
                  {fadeBool && (
                    <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                      <input type="text" value={fade} className="short"
                        onChange={e => setFade(e.target.value)} style={{ width:46 }} />
                      <span style={{ fontSize:'0.78rem', color:'#555' }}>sec</span>
                    </span>
                  )}
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={fadeBool}
                    onChange={e => { setFadeBool(e.target.checked); if (e.target.checked && !fade) setFade('30'); }} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="toggle-wrap">
                <label>Small Caps</label>
                <label className="toggle">
                  <input type="checkbox" checked={smallCaps} onChange={e => setSmallCaps(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="toggle-wrap">
                <label><abbr title="New Line">NL</abbr> after name</label>
                <label className="toggle">
                  <input type="checkbox" checked={nlAfterName} onChange={e => setNlAfterName(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="toggle-wrap">
                <label>Hide usernames</label>
                <label className="toggle">
                  <input type="checkbox" checked={hideNames} onChange={e => setHideNames(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="toggle-wrap">
                <label>Pinned messages</label>
                <label className="toggle">
                  <input type="checkbox" checked={showPin} onChange={e => setShowPin(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="toggle-wrap">
                <label>Platform icons</label>
                <label className="toggle">
                  <input type="checkbox" checked={platformIcons} onChange={e => setPlatformIcons(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div style={{ borderTop:'1px solid #2a2a2a', marginTop:8, paddingTop:10 }}>
                <p style={{ margin:'0 0 6px', fontSize:'0.78rem', color:'#555', textAlign:'right' }}>Extra bots to hide (comma-separated)</p>
                <input type="text" placeholder="nightbot, streamelements…"
                  style={{ width:'100%', fontSize:'0.78rem' }}
                  value={botNames} onChange={e => setBotNames(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Preview + Generate */}
          <div id="submit_container">
            <div className="preview-wrap">
              <div className="preview-label">
                <span>click 👉 </span>
                <button type="button" onClick={() => setPreviewWhite(p => !p)} title="Toggle background">⚙️</button>
                <span>Preview:</span>
              </div>
              <div id="example" className={previewWhite ? 'white' : 'checkered'}>
                <div className="example-inner" style={{
                  fontFamily: fontCSS, fontSize: psz.fs, lineHeight: psz.lh,
                  fontVariant: smallCaps ? 'small-caps' : undefined,
                  fontWeight: 800,
                  color: 'white',
                  ...(pFilter ? { filter: pFilter } : {}),
                  ...(pStroke ? { WebkitTextStroke: pStroke } : {}),
                }}>
                  <style>{`
                    .pb { width:${psz.bw}!important; height:${psz.bh}!important; min-width:${psz.bw}; min-height:${psz.bh}; max-width:${psz.bw}; max-height:${psz.bh}; vertical-align:middle; border-radius:10%; display:inline-block; margin-right:${psz.bmr}; margin-bottom:${psz.bmb}; }
                    .pb:last-of-type { margin-right:${psz.blmr}; }
                    .pb.pb-wide { width:auto!important; min-width:0; max-width:calc(${psz.bw} * 2.5); border-radius:0; }
                    /* platform icon — same box/baseline as badges; !important
                       beats the icon's inline height:1em (which tracks the
                       preview font-size, not the badge row) */
                    .ptag { display:inline-block; vertical-align:middle; margin-right:${psz.bmr}; margin-bottom:${psz.bmb}; line-height:0; }
                    .ptag span { margin:0!important; vertical-align:middle!important; display:inline-flex!important; }
                    .ptag svg, .ptag img { height:${psz.bh}!important; width:auto!important; display:inline-block; vertical-align:middle; }
                    .pc { margin-right:${psz.cmr}; }
                    .pe { max-height:${psz.eh}; max-width:${psz.ew}; height:auto; width:auto; vertical-align:middle; display:inline-block; margin-right:-3px; }
                  `}</style>
                  {PREV_MSGS.map((m, i) => (
                    <div key={i} style={{
                      lineHeight: psz.lh,
                    }}>
                      {!hideNames && (
                        <span style={{ display:'inline-block' }}>
                          <span className="ptag">{sourceTag(m.platform, 'icon')}</span>
                          {m.badges.map((b, bi) => (
                            <img key={bi} className={b.alt === 'topGifter' ? 'pb pb-wide' : 'pb'} src={b.src} alt={b.alt} />
                          ))}
                          <span style={{
                            fontWeight: 800,
                            ...(m.paint && sevenTVC ? {
                              background: m.paint,
                              WebkitBackgroundClip: 'text',
                              WebkitTextFillColor: 'transparent',
                              backgroundClip: 'text',
                            } : { color: m.color }),
                          }}>{m.user}</span>
                          {!nlAfterName ? <span className="pc">:</span> : <br />}
                        </span>
                      )}{' '}
                      <span>
                        {m.msg}
                        {m.emotes.map((e, ei) => sevenTVE
                          ? <img key={ei} className="pe" src={e.src} alt={e.alt} />
                          : <span key={ei}> {e.alt}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div style={{ display:'flex', justifyContent:'center', marginTop:14 }}>
            <input type="submit" value="Generate & Copy" />
          </div>
        </form>

        {/* URL result */}
        <div id="result">
          <div className="url-box">
            <div className="url-code">{overlayUrl}</div>
            <button onClick={copy} className={`url-copy${copied ? ' ok' : ''}`} type="button">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="url-actions">
            <a href={overlayUrl} target="_blank" rel="noreferrer" className="url-newtab">
              👁️ Preview in new tab <span style={{fontSize:'0.7rem', color:'#888'}}>(type in your chat to test)</span>
            </a>
            <span style={{ fontSize:'0.78rem', color:'#444' }}>Works at any resolution — set whatever fits your layout</span>
          </div>
        </div>

        {/* Viewer Counter */}
        <div className="setup-section">
          <p className="section-title">Viewer Counter Overlay</p>
          <p style={{ color:'#909090', fontSize:'0.85rem', margin:'0 0 10px', lineHeight:1.5 }}>
            A second browser source: real-time viewer count across all your platforms.
            Offline platforms slide out automatically; counts roll smoothly as viewership changes.
            Uses the same channel names entered above.
          </p>
          <div className="form_row left" style={{ flexWrap:'wrap', gap:12 }}>
            <label>Display{' '}
              <select value={vcCombined} onChange={e => setVcCombined(e.target.value)}>
                <option value="true">Combined total</option>
                <option value="false">Per platform</option>
              </select>
            </label>
            <label>Font{' '}
              <select value={vcFont} onChange={e => setVcFont(e.target.value)}>
                <option value="dejavu">DejaVu Sans Bold</option>
                <option value="montserrat">Montserrat Bold</option>
              </select>
            </label>
            <label>Icons{' '}
              <select value={vcIcons} onChange={e => setVcIcons(e.target.value)}>
                <option value="true">Show</option>
                <option value="false">Hide</option>
              </select>
            </label>
            <label>Background{' '}
              <select value={vcBg} onChange={e => setVcBg(e.target.value)}>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </label>
          </div>
          <div className="url-box">
            <div className="url-code">{counterUrl}</div>
            <button onClick={copyCounter} className={`url-copy${copiedCounter ? ' ok' : ''}`} type="button">
              {copiedCounter ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <p style={{ color:'#555', fontSize:'0.79rem', margin:'6px 0 0' }}>
            Size/shadow/stroke options from the generator above apply here too. Recommended OBS size: 400 × 80.
          </p>
        </div>

        {/* OBS Setup */}
        <div className="setup-section">
          <p className="section-title">OBS Setup</p>
          <ol className="steps">
            <li>Enter your channel name(s) — any one platform or all four — then click <strong>Generate &amp; Copy</strong></li>
            <li>In OBS: <strong>Add Source → Browser Source</strong></li>
            <li>Paste the URL and set your preferred size — my personal favorite is <strong>680 × 280</strong></li>
          </ol>
        </div>

      </div>

      <footer>
        <p>multichat-gxufy with 🕊️ — <a href="https://x.com/Gxufy_" target="_blank" rel="noreferrer">https://x.com/Gxufy_</a></p>
        <p>Inspired by <a href="https://chatis.is2511.com/" target="_blank" rel="noreferrer">ChatIS</a> by IS2511 &amp; giambaJ</p>
        <p>Not affiliated with <a href="https://kick.com" target="_blank" rel="noreferrer">Kick</a>, <a href="https://twitch.tv" target="_blank" rel="noreferrer">Twitch</a>, <a href="https://youtube.com" target="_blank" rel="noreferrer">YouTube</a>, or <a href="https://tiktok.com" target="_blank" rel="noreferrer">TikTok</a></p>
      </footer>
    </>
  );
}
