import { useState, useEffect } from 'react';
import Head from 'next/head';
import { sourceTag } from '../lib/render';
import type { Platform } from '../lib/types';
import CounterPreview from './CounterPreview';

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
    user: 'Gxufy',
    badges: [
      { src: 'https://p16-webcast.tiktokcdn.com/webcast-sg/new_top_gifter_version_2.png~tplv-obj.image', alt: 'topGifter' },
    ],
    msg: 'Pinned by Gxufy: Fan Club Level 12 unlocked — join the club and grab your badge! ',
    emotes: [],
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
  const [mentionColor, setMentionColor] = useState(true);
  const [bgColor,     setBgColor]     = useState('');      // '' = transparent
  const [customMsgs,  setCustomMsgs]  = useState<Array<{ user: string; color: string; msg: string }>>([]);
  const [testInput,   setTestInput]   = useState('');
  const [vcCombined,  setVcCombined]  = useState('true');
  const [vcFont,      setVcFont]      = useState('dejavu');
  const [vcIcons,     setVcIcons]     = useState('true');
  const [vcBg,        setVcBg]        = useState('true');
  const [copiedCounter, setCopiedCounter] = useState(false);
  const [activeTab,   setActiveTab]   = useState<'counter' | 'commands' | 'setup' | null>(null);
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
    ...(mentionColor ? {} : { mentionColor: 'false' }),
    ...(bgColor ? { bgColor: bgColor.replace('#', '') } : {}),
    ...(emoteScale !== '' ? { emoteScale } : {}),
    smallCaps:   String(smallCaps),
    nlAfterName: String(nlAfterName),
    hideNames:   String(hideNames),
    ...(botNames.trim() ? { botNames: botNames.trim() } : {}),
  });
  const overlayUrl = `${baseUrl}/multichat?${params.toString()}`;

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

  /* UChat preview.ts sendFakeMessage: random 5-char name + random color */
  const sendTestMsg = () => {
    const msg = testInput.trim();
    if (!msg) return;
    const user = Math.random().toString(36).slice(2, 7);
    const colors = ['#FF4B6E', '#53fc18', '#00BFFF', '#D399FF', '#FF8C00', '#9ACD32', '#FF69B4'];
    setCustomMsgs(prev => [...prev.slice(-7), { user, color: colors[Math.floor(Math.random() * colors.length)], msg }]);
    setTestInput('');
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
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Baloo+Tammudu+2:wght@400;500;600;700;800&family=Comfortaa:wght@300;400;500;600;700&family=Dancing+Script:wght@400;500;600;700&family=Indie+Flower&family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,400&family=Noto+Sans+JP:wght@100;300;400;500;700;900&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,400&family=Source+Code+Pro:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,900;1,400&display=swap" rel="stylesheet" />
        <style>{`@font-face{font-family:Alsina;src:url(https://chatis.is2511.com/v2/styles/Alsina_Ultrajada.ttf);}`}</style>
      </Head>

      <style>{`
        /* ── multichat design system ──
           ChatIS-v2 card language (charcoal cards, chunky shadows, pill
           toggles, one accent) reorganized with StreamNook polish:
           every section is a card, controls feel tactile, single accent
           #4a84fa used sparingly. Montserrat for UI. */
        *, *::before, *::after { box-sizing: border-box; }
        :root {
          --bg: #141418;
          --card: #1d1d23;
          --card-2: #24242c;
          --line: #2c2c35;
          --text: #e2e2e8;
          --muted: #9a9aa5;
          --dim: #62626e;
          --accent: #4a84fa;
          --accent-2: #6d9dff;
          --shadow: 0 4px 24px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.5);
        }
        html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: 'Montserrat', 'Noto Sans JP', system-ui, sans-serif; font-size: 16px; }
        body { background-image: radial-gradient(ellipse 900px 420px at 50% -80px, rgba(74,132,250,0.09), transparent); }
        a { color: var(--accent); text-decoration: none; transition: opacity .2s; } a:hover { color: var(--accent-2); opacity: .85; }
        .page { max-width: 900px; margin: 0 auto; padding: 0 20px 60px; }

        /* Header — compact horizontal strip, no giant hero */
        header.header-strip { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 20px; padding: 10px 0 16px; margin-bottom: 18px; position: relative; }
        header.header-strip::after { content: ''; position: absolute; bottom: 0; left: 15%; right: 15%; height: 2px; background: linear-gradient(90deg, transparent, var(--accent), transparent); }
        .header-logo { height: 150px; width: auto; margin: -20px 0 -30px; filter: drop-shadow(0 8px 20px rgba(0,0,0,.5)); }
        .header-copy { display: flex; flex-direction: column; gap: 4px; }
        @keyframes ckSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .header-title { font-size: 2rem; font-weight: 800; color: #fff; margin: 0; letter-spacing: -.04em; }
        .header-sub { font-size: 0.9rem; font-weight: 600; color: var(--accent); margin: 0; }
        .platform-row { display: flex; gap: 6px; margin-top: 2px; }
        .platform-chip { font-size: 0.64rem; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; padding: 2px 10px; border-radius: 999px; background: rgba(255,255,255,0.03); }

        /* Tab bar — extras collapse behind buttons, page stays short */
        .tab-bar { display: flex; gap: 10px; margin-bottom: 18px; }
        .tab-btn { flex: 1; background: var(--card); border: 1px solid var(--line); border-radius: 12px; color: var(--muted); font-family: inherit; font-size: 0.88rem; font-weight: 700; padding: 13px 10px; cursor: pointer; transition: all .15s; box-shadow: var(--shadow); }
        .tab-btn:hover { border-color: rgba(74,132,250,.5); color: var(--text); transform: translateY(-1px); }
        .tab-btn.on { background: rgba(74,132,250,.12); border-color: var(--accent); color: var(--accent); }

        /* Cards — every section is one */
        .commands-section, .setup-section, #result {
          background: var(--card); border: 1px solid var(--line); border-radius: 14px;
          padding: 20px 22px; margin-bottom: 22px; box-shadow: var(--shadow);
        }
        .section-title { font-size: 0.8rem; color: var(--accent); font-weight: 700; margin: 0 0 12px; text-transform: uppercase; letter-spacing: .12em; display: flex; align-items: center; gap: 8px; }
        .section-title::before { content: ''; width: 4px; height: 14px; border-radius: 2px; background: var(--accent); }

        /* Commands table */
        .cmd-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; }
        .cmd-table th { text-align: left; color: var(--dim); font-weight: 700; text-transform: uppercase; font-size: 0.68rem; letter-spacing: .08em; padding: 4px 10px 8px; border-bottom: 1px solid var(--line); }
        .cmd-table td { padding: 7px 10px; color: var(--muted); border-bottom: 1px solid rgba(44,44,53,.5); vertical-align: top; line-height: 1.45; }
        .cmd-table td:first-child { color: var(--accent); font-family: 'Roboto Mono', monospace; white-space: nowrap; font-size: 0.72rem; }
        .cmd-table tr:last-child td { border-bottom: none; }
        .cmd-table tr:hover td { background: rgba(255,255,255,0.015); }
        .cmd-access { font-size: 0.7rem; color: var(--dim); }

        /* Generator card — the hero card */
        form[name="generator"] {
          background: var(--card); border: 1px solid var(--line); border-top: 2px solid var(--accent);
          border-radius: 14px; padding: 26px 26px 20px; margin-bottom: 22px; box-shadow: var(--shadow);
        }
        .form_row.center { display: flex; justify-content: center; margin-bottom: 18px; }
        .form_row.center input[type=text] { width: 100%; max-width: 360px; text-align: center; font-size: 1.05rem; padding: 10px 16px; }
        .platform-inputs { gap: 12px; flex-wrap: wrap; }
        .platform-input { display: flex; flex-direction: column; align-items: center; gap: 5px; flex: 1; min-width: 150px; }
        .platform-input input[type=text] { max-width: none; font-size: 0.92rem; padding: 9px 12px; width: 100%; }
        .platform-tag { font-size: 0.66rem; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; padding: 2px 10px; border-radius: 999px; }
        .kick-tag { color: #53fc18; border: 1px solid rgba(83,252,24,.55); background: rgba(83,252,24,.06); }
        .tw-tag { color: #a970ff; border: 1px solid rgba(145,70,255,.55); background: rgba(145,70,255,.07); }
        .yt-tag { color: #ff5b5b; border: 1px solid rgba(255,68,68,.55); background: rgba(255,68,68,.06); }
        .tt-tag { color: #25F4EE; border: 1px solid rgba(37,244,238,.5); background: rgba(37,244,238,.05); }
        .form_table { display: flex; gap: 0; margin-bottom: 14px; background: var(--card-2); border: 1px solid var(--line); border-radius: 10px; padding: 16px 4px 6px; }
        .form_col { flex: 1; padding: 0 18px; }
        .form_col:first-child { border-right: 1px solid var(--line); }
        .form_row { display: flex; align-items: center; margin-bottom: 11px; gap: 8px; }
        .form_row.left { justify-content: flex-start; }

        input[type=text], input[type=number], select {
          background: #16161b; border: 1px solid var(--line); border-radius: 8px; color: var(--text);
          padding: 6px 11px; font-size: 0.86rem; font-family: inherit; outline: none;
          transition: border-color .15s, box-shadow .15s;
        }
        input[type=text]:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(74,132,250,.15); }
        select option { background: var(--card); }
        input[type=text].short { width: 52px; }
        label { font-size: 0.85rem; color: var(--muted); cursor: pointer; user-select: none; }
        label abbr { text-decoration: underline dotted; cursor: help; }

        /* Pill toggles — ChatIS signature control, scaled to our palette */
        .toggle-wrap { display: flex; align-items: center; gap: 10px; justify-content: flex-end; margin-bottom: 12px; }
        .toggle-wrap > label:first-child { font-size: 0.85rem; color: var(--muted); cursor: pointer; user-select: none; order: -1; flex: 1; text-align: right; }
        .toggle { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .toggle-slider { position: absolute; inset: 0; background: #34343e; border-radius: 999px; cursor: pointer; transition: background .2s ease-in-out; }
        .toggle-slider::before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; background: #fff; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,.4); transition: transform .2s ease-in-out; }
        .toggle input:checked + .toggle-slider { background: var(--accent); }
        .toggle input:checked + .toggle-slider::before { transform: translateX(20px); }

        /* Preview */
        #submit_container { display: flex; flex-direction: column; gap: 0; margin-top: 14px; }
        .preview-wrap { width: 100%; }
        .preview-label { font-size: 0.75rem; color: var(--dim); margin-bottom: 6px; display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
        .preview-label button { background: none; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); font-size: 0.72rem; padding: 2px 9px; cursor: pointer; transition: all .15s; text-transform: none; letter-spacing: 0; font-weight: 500; }
        .preview-label button:hover { border-color: var(--accent); color: var(--accent); }
        #example, #counter-example { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; transition: background .2s; box-shadow: inset 0 2px 12px rgba(0,0,0,.3); }
        #example.white, #counter-example.white { background: #46464e; }
        #example.checkered, #counter-example.checkered { background: repeating-conic-gradient(#1a1a20 0% 25%, #131318 0% 50%) 0 0 / 16px 16px; }
        .example-inner { width: calc(100% - 20px); padding: 10px; word-break: break-word; font-weight: 800; color: white; }

        input[type=submit] {
          background: var(--accent); color: #fff; border: none; border-radius: 10px;
          font-size: 0.98rem; font-weight: 800; padding: 13px 32px; cursor: pointer; font-family: inherit;
          letter-spacing: -.01em; box-shadow: 0 4px 16px rgba(74,132,250,.35);
          transition: background .15s, transform .1s, box-shadow .15s;
        }
        input[type=submit]:hover { background: var(--accent-2); transform: translateY(-1px); box-shadow: 0 6px 20px rgba(74,132,250,.45); }
        input[type=submit]:active { transform: translateY(0); }

        /* URL result */
        .url-box { display: flex; gap: 8px; align-items: stretch; }
        .url-code { flex: 1; background: #101014; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-family: 'Roboto Mono', monospace; font-size: 0.7rem; color: var(--accent); word-break: break-all; line-height: 1.7; }
        .url-copy { flex-shrink: 0; background: var(--accent); color: #fff; border: none; border-radius: 8px; font-weight: 800; font-size: 0.83rem; padding: 0 20px; cursor: pointer; transition: background .15s; font-family: inherit; }
        .url-copy:hover { background: var(--accent-2); }
        .url-copy.ok { background: #2fbf71; }
        .url-actions { display: flex; gap: 10px; margin-top: 10px; align-items: center; flex-wrap: wrap; }
        .url-newtab { font-size: 0.8rem; color: var(--accent); display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(74,132,250,.4); border-radius: 8px; padding: 6px 14px; transition: all .15s; }
        .url-newtab:hover { background: rgba(74,132,250,0.1); border-color: var(--accent); }
        #result > p { color: var(--dim); font-size: 0.78rem; margin: 8px 0 0; }

        /* Setup steps */
        .steps { list-style: none; padding: 0; margin: 0; counter-reset: s; }
        .steps li { counter-increment: s; display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px; font-size: 0.86rem; color: var(--muted); line-height: 1.55; }
        .steps li::before { content: counter(s); background: rgba(74,132,250,.12); border: 1px solid rgba(74,132,250,.4); border-radius: 50%; min-width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; color: var(--accent); flex-shrink: 0; margin-top: 1px; }
        .steps li strong { color: var(--text); }

        /* Footer */
        footer { border-top: 1px solid var(--line); padding: 22px 0; text-align: center; font-size: 0.78rem; color: var(--dim); margin-top: 24px; }
        footer p { margin: 4px 0; }
        footer a { color: var(--accent); }

        @media (max-width: 720px) {
          .form_table { flex-direction: column; }
          .form_col:first-child { border-right: none; border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 12px; }
          .header-logo { height: 260px; margin-top: -30px; margin-bottom: -70px; }
        }
      `}</style>

      <div className="page">

        {/* Header — compact strip: logo left, title + chips inline */}
        <header className="header-strip">
          <img src="/tpl.webp" alt="multichat" className="header-logo" />
          <div className="header-copy">
            <h1 className="header-title">multichat-gxufy</h1>
            <p className="header-sub">Every chat. One overlay. No login.</p>
            <div className="platform-row">
              <span className="platform-chip kick-tag">Kick</span>
              <span className="platform-chip tw-tag">Twitch</span>
              <span className="platform-chip yt-tag">YouTube</span>
              <span className="platform-chip tt-tag">TikTok</span>
            </div>
          </div>
        </header>

        {/* Generator form — first thing, no scroll needed */}
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
              <div className="toggle-wrap">
                <label><abbr title="Highlight @mentions in the mentioned user's name color (they must have chatted before)">Colored mentions</abbr></label>
                <label className="toggle">
                  <input type="checkbox" checked={mentionColor} onChange={e => setMentionColor(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="toggle-wrap">
                <label><abbr title="Chat background color. Transparent is the default — pick a color only if you don't want a see-through overlay">Background</abbr></label>
                <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                  <button type="button"
                    onClick={() => setBgColor('')}
                    style={{
                      fontSize:'0.72rem', padding:'2px 8px', borderRadius:4, cursor:'pointer',
                      border: bgColor === '' ? '1px solid #4a84fa' : '1px solid #3a3a3a',
                      background:'#2e2e2e', color: bgColor === '' ? '#4a84fa' : '#888',
                    }}>Transparent</button>
                  <input type="color" value={bgColor || '#191919'}
                    onChange={e => setBgColor(e.target.value)}
                    style={{ width:28, height:22, padding:0, border:'1px solid #3a3a3a', borderRadius:4, background:'none', cursor:'pointer' }} />
                </span>
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
              <div id="example" className={previewWhite ? 'white' : 'checkered'}
                style={bgColor ? { background: bgColor } : undefined}>
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
                  {/* user-injected test messages (UChat preview Send box) */}
                  {customMsgs.map((m, i) => (
                    <div key={`c${i}`} style={{ lineHeight: psz.lh }}>
                      {!hideNames && (
                        <span style={{ display:'inline-block' }}>
                          <span className="ptag">{sourceTag('kick', 'icon')}</span>
                          <span style={{ fontWeight: 800, color: m.color }}>{m.user}</span>
                          {!nlAfterName ? <span className="pc">:</span> : <br />}
                        </span>
                      )}{' '}
                      <span>{mentionColor
                        ? m.msg.split(' ').map((w, wi) => w.startsWith('@')
                          ? <strong key={wi} style={{ color: '#53fc18' }}>{w} </strong>
                          : w + ' ')
                        : m.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* UChat-style test message box */}
              <div style={{ display:'flex', gap:8, marginTop:8 }}>
                <input type="text" placeholder="Send a test message… (try @Gxufy)"
                  value={testInput}
                  onChange={e => setTestInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendTestMsg(); } }}
                  style={{ flex:1, fontSize:'0.82rem' }} />
                <button type="button" onClick={sendTestMsg}
                  style={{ background:'#4a84fa', color:'#fff', border:'none', borderRadius:5,
                           fontWeight:800, fontSize:'0.8rem', padding:'0 16px', cursor:'pointer' }}>
                  Send
                </button>
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
            <a href={overlayUrl} target="_blank" rel="noreferrer" className="url-copy" style={{ display:'inline-flex', alignItems:'center', background:'transparent', border:'1px solid rgba(74,132,250,.5)', color:'#4a84fa' }}>
              👁️ Test
            </a>
          </div>
        </div>

        {/* Tabs — counter / commands / setup collapse into one bar */}
        <div className="tab-bar">
          {([['counter','📊 Viewer Counter'],['commands','⚡ Commands'],['setup','🎥 OBS Setup']] as const).map(([key, label]) => (
            <button key={key} type="button"
              className={`tab-btn${activeTab === key ? ' on' : ''}`}
              onClick={() => setActiveTab(activeTab === key ? null : key)}>
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'counter' && (
        <div className="setup-section">
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

          <div id="counter-example" className={previewWhite ? 'white' : 'checkered'}
            style={{ border:'1px solid #444', borderRadius:6, overflow:'hidden', padding:'14px 12px', marginTop:8 }}>
            <CounterPreview
              combined={vcCombined === 'true'}
              font={vcFont}
              icons={vcIcons === 'true'}
              bg={vcBg === 'true'}
              textSize={textSize}
              textShadow={textShadow}
              stroke={stroke}
            />
          </div>
          <div className="url-box" style={{ marginTop:8 }}>
            <div className="url-code">{counterUrl}</div>
            <button onClick={copyCounter} className={`url-copy${copiedCounter ? ' ok' : ''}`} type="button">
              {copiedCounter ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <p style={{ color:'#555', fontSize:'0.76rem', margin:'6px 0 0' }}>
            Real-time counts, offline platforms slide out. OBS size: 400 × 80.
          </p>
        </div>
        )}

        {activeTab === 'commands' && (
        <div className="commands-section">
          <table className="cmd-table">
            <thead><tr><th>Command</th><th>Description</th><th>Access</th></tr></thead>
            <tbody>
              <tr><td>!multichat ping</td><td>Pong! notification on screen</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat reload</td><td>Reloads the browser source</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat stop</td><td>Clears all active overlays</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat show / hide</td><td>Shows or hides the chat</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat refresh emotes</td><td>Reloads 7TV/BTTV/FFZ emotes live</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat img [url/emote] -t [s] -o [op]</td><td>Fullscreen image or emote. <code style={{color:'#4a84fa'}}>img clear</code> dismisses</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat yt [url/preset] -t [s] -m</td><td>Fullscreen video. Presets: bruh, vine-boom, rickroll, dc-ping, win-error</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!multichat tts [message]</td><td>Text-to-speech in OBS</td><td className="cmd-access">Mod+</td></tr>
            </tbody>
          </table>
          <p style={{ color:'#555', fontSize:'0.74rem', margin:'6px 0 0' }}>Works from any connected platform&rsquo;s chat. <code style={{color:'#4a84fa'}}>!kickchat</code> is an alias.</p>
        </div>
        )}

        {activeTab === 'setup' && (
        <div className="setup-section">
          <ol className="steps">
            <li>Enter channel name(s) above → <strong>Generate &amp; Copy</strong></li>
            <li>OBS: <strong>Add Source → Browser Source</strong> → paste</li>
            <li>Size it — <strong>680 × 280</strong> works great</li>
          </ol>
        </div>
        )}

      </div>

      <footer>
        <p>multichat-gxufy with 🕊️ — <a href="https://x.com/Gxufy_" target="_blank" rel="noreferrer">https://x.com/Gxufy_</a></p>
        <p>Inspired by <a href="https://chatis.is2511.com/" target="_blank" rel="noreferrer">ChatIS</a> by IS2511 &amp; giambaJ</p>
        <p>Not affiliated with <a href="https://kick.com" target="_blank" rel="noreferrer">Kick</a>, <a href="https://twitch.tv" target="_blank" rel="noreferrer">Twitch</a>, <a href="https://youtube.com" target="_blank" rel="noreferrer">YouTube</a>, or <a href="https://tiktok.com" target="_blank" rel="noreferrer">TikTok</a></p>
      </footer>
    </>
  );
}
