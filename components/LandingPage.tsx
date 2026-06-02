import { useState, useEffect } from 'react';
import Head from 'next/head';

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

// Preview messages — exact requested names, badges, messages, emotes
const PREV_MSGS = [
  {
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
    color: '#FF8C00',
    paint: null,
    user: 'Annoying',
    badges: [
      { src: '/badges/gift_25-99.svg', alt: 'subGifter50' },
      { src: '/badges/founder.svg', alt: 'founder' },
      { src: '/badges/verified.svg', alt: 'verified' },
    ],
    msg: "Check DMs, I gave you max prio for my GTA server \"The Towns\". ",
    emotes: [{ src: 'https://cdn.7tv.app/emote/01GFWC73G8000F5SH2VRR170BE/2x.webp', alt: 'BANGER' }],
  },
  {
    color: '#53fc18',
    paint: 'linear-gradient(90deg, #53fc18, #00e5ff, #53fc18)',
    user: 'Gxufy',
    badges: [
      { src: '/badges/gift_25-99.svg', alt: 'subGifter50' },
      { src: '/badges/moderator.svg', alt: 'moderator' },
      { src: '/badges/sidekick.svg', alt: 'sidekick' },
    ],
    msg: 'how do you like my new kick chat overlay? ',
    emotes: [{ src: 'https://cdn.7tv.app/emote/01H3HH5M180005101ADVY57FSB/2x.webp', alt: 'gg' }],
  },
  {
    color: '#D399FF',
    paint: 'linear-gradient(135deg, #D399FF, #7c3aed, #D399FF)',
    user: 'Konvy',
    badges: [
      { src: '/badges/gift_10-24.svg', alt: 'subGifter25' },
      { src: '/badges/broadcaster.svg', alt: 'broadcaster' },
      { src: '/badges/verified.svg', alt: 'verified' },
    ],
    msg: "WORD TO MY M*THER I DON'T VIEWBOT ",
    emotes: [{ src: 'https://cdn.7tv.app/emote/01K4H935HDHW7MASYMQ2Y3P967/2x.webp', alt: 'ohnono' }],
  },
  {
    color: '#00BFFF',
    paint: 'linear-gradient(90deg, #00BFFF, #0080ff, #00BFFF)',
    user: 'Trainwreckstv',
    badges: [
      { src: '/badges/gift_100-149.svg', alt: 'subGifter100' },
      { src: '/badges/vip.svg', alt: 'vip' },
      { src: '/badges/staff.svg', alt: 'staff' },
      { src: '/badges/trainwreckstv.svg', alt: 'trainwreckstv' },
    ],
    msg: "I've been tuning in to your streams. Keep up the good work! ",
    emotes: [{ src: 'https://cdn.7tv.app/emote/01GZ2CTDQ000093EMR4AKWQ462/2x.webp', alt: 'lebronArrive' }],
  },
];

export default function LandingPage() {
  const [channel,     setChannel]     = useState('');
  const [sevenTVE,    setSevenTVE]    = useState(true);
  const [sevenTVC,    setSevenTVC]    = useState(true);
  const [textSize,    setTextSize]    = useState('medium');
  const [font,        setFont]        = useState('noto');
  const [textShadow,  setTextShadow]  = useState('large');
  const [stroke,      setStroke]      = useState('none');
  const [animation,   setAnimation]   = useState('slide');
  const [fade,        setFade]        = useState('30');
  const [fadeBool,    setFadeBool]    = useState(true);
  const [showPin,     setShowPin]     = useState(true);
  const [emoteScale,  setEmoteScale]  = useState('');
  const [smallCaps,   setSmallCaps]   = useState(false);
  const [nlAfterName, setNlAfterName] = useState(false);
  const [hideNames,   setHideNames]   = useState(false);
  const [botNames,    setBotNames]    = useState('');
  const [copied,      setCopied]      = useState(false);
  const [previewWhite, setPreviewWhite] = useState(false);
  const [baseUrl,     setBaseUrl]     = useState('https://kickchat-gxufy.vercel.app');

  useEffect(() => { setBaseUrl(window.location.origin); }, []);

  const params = new URLSearchParams({
    channel: channel || 'yourchannel',
    sevenTVEmotesEnabled:    String(sevenTVE),
    sevenTVCosmeticsEnabled: String(sevenTVC),
    textSize, font, textShadow, stroke, animation,
    ...(fadeBool && fade !== '' ? { fade } : {}),
    showPinEnabled:        String(showPin),
    ...(emoteScale !== '' ? { emoteScale } : {}),
    smallCaps:   String(smallCaps),
    nlAfterName: String(nlAfterName),
    hideNames:   String(hideNames),
    ...(botNames.trim() ? { botNames: botNames.trim() } : {}),
  });
  const overlayUrl = `${baseUrl}/?${params.toString()}`;

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
        <title>kickchat-gxufy | Kick Chat Overlay</title>
        <meta name="description" content="Free Kick chat overlay for OBS by gxufy — 7TV emotes, badges, name-paints." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Baloo+Tammudu+2:wght@400;500;600;700;800&family=Comfortaa:wght@300;400;500;600;700&family=Dancing+Script:wght@400;500;600;700&family=Indie+Flower&family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,400&family=Noto+Sans+JP:wght@100;300;400;500;700;900&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,400&family=Source+Code+Pro:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,900;1,400&display=swap" rel="stylesheet" />
        <style>{`@font-face{font-family:Alsina;src:url(https://chatis.is2511.com/v2/styles/Alsina_Ultrajada.ttf);}`}</style>
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #1a1a1a; color: #d8d8d8; font-family: 'Noto Sans JP', system-ui, sans-serif; font-size: 16px; }
        a { color: #53fc18; } a:hover { color: #7aff4a; }
        .page { max-width: 860px; margin: 0 auto; padding: 0 20px 60px; }

        /* Header */
        header { display: flex; flex-direction: column; align-items: center; padding: 28px 0 20px; margin-bottom: 24px; border-bottom: 2px solid #53fc18; gap: 8px; }
        .header-logo { width: 96px; height: 96px; animation: ckSpin 3s linear infinite; }
        @keyframes ckSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .header-title { font-size: 2.4rem; font-weight: 800; color: #fff; margin: 0; letter-spacing: -.03em; }
        .header-sub { font-size: 1rem; font-weight: 400; color: #53fc18; margin: 0; }

        /* Commands */
        .commands-section { margin-bottom: 24px; }
        .section-title { font-size: 0.82rem; color: #53fc18; font-weight: 700; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .08em; }
        .cmd-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; }
        .cmd-table th { text-align: left; color: #53fc18; font-weight: 600; padding: 4px 10px 6px; border-bottom: 1px solid #333; }
        .cmd-table td { padding: 5px 10px; color: #a0a0a0; border-bottom: 1px solid #252525; vertical-align: top; }
        .cmd-table td:first-child { color: #53fc18; font-family: 'Roboto Mono', monospace; white-space: nowrap; font-size: 0.72rem; }
        .cmd-table tr:last-child td { border-bottom: none; }
        .cmd-access { font-size: 0.7rem; color: #555; }

        /* Form */
        form[name="generator"] { background: #232323; border: 1px solid #53fc18; border-radius: 10px; padding: 24px 24px 18px; margin-bottom: 20px; }
        .form_row.center { display: flex; justify-content: center; margin-bottom: 16px; }
        .form_row.center input[type=text] { width: 100%; max-width: 360px; text-align: center; font-size: 1.1rem; padding: 10px 16px; }
        .form_table { display: flex; gap: 0; margin-bottom: 14px; }
        .form_col { flex: 1; }
        .form_col:first-child { border-right: 1px solid #2e2e2e; padding-right: 24px; }
        .form_col:last-child { padding-left: 24px; }
        .form_row { display: flex; align-items: center; margin-bottom: 11px; gap: 8px; }
        .form_row.left { justify-content: flex-start; }

        input[type=text], input[type=number], select { background: #2e2e2e; border: 1px solid #3a3a3a; border-radius: 5px; color: #d8d8d8; padding: 5px 10px; font-size: 0.87rem; font-family: inherit; outline: none; transition: border-color .15s; }
        input[type=text]:focus, select:focus { border-color: #53fc18; }
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
        .toggle input:checked + .toggle-slider { background: #1a3a0a; }
        .toggle input:checked + .toggle-slider::before { transform: translateX(16px); background: #53fc18; }

        /* Preview */
        #submit_container { display: flex; flex-direction: column; gap: 0; margin-top: 14px; }
        .preview-wrap { width: 100%; }
        .preview-label { font-size: 0.78rem; color: #666; margin-bottom: 5px; display: flex; align-items: center; gap: 6px; }
        .preview-label button { background: none; border: 1px solid #444; border-radius: 4px; color: #888; font-size: 0.75rem; padding: 1px 7px; cursor: pointer; transition: border-color .15s, color .15s; }
        .preview-label button:hover { border-color: #53fc18; color: #53fc18; }
        #example { border: 1px solid #444; border-radius: 6px; overflow: hidden; transition: background .2s; }
        #example.white { background: #3a3a3a; }
        #example.checkered { background: repeating-conic-gradient(#1e1e1e 0% 25%, #171717 0% 50%) 0 0 / 16px 16px; }
        .example-inner { width: calc(100% - 20px); padding: 10px; word-break: break-word; font-weight: 800; color: white; }


        input[type=submit] { background: #53fc18; color: #000; border: none; border-radius: 7px; font-size: 1rem; font-weight: 800; padding: 12px 28px; cursor: pointer; font-family: inherit; transition: background .15s, transform .1s; align-self: flex-end; letter-spacing: -.01em; }
        input[type=submit]:hover { background: #7aff4a; transform: translateY(-1px); }
        input[type=submit]:active { transform: translateY(0); }

        /* URL result */
        #result { margin-bottom: 24px; }
        .url-box { display: flex; gap: 8px; align-items: stretch; }
        .url-code { flex: 1; background: #111; border: 1px solid #53fc18; border-radius: 5px; padding: 10px 12px; font-family: 'Roboto Mono', monospace; font-size: 0.7rem; color: #53fc18; word-break: break-all; line-height: 1.7; }
        .url-copy { flex-shrink: 0; background: #53fc18; color: #000; border: none; border-radius: 5px; font-weight: 800; font-size: 0.85rem; padding: 0 20px; cursor: pointer; transition: background .15s; font-family: inherit; }
        .url-copy.ok { background: #7aff4a; }
        .url-actions { display: flex; gap: 10px; margin-top: 8px; align-items: center; flex-wrap: wrap; }
        .url-newtab { font-size: 0.82rem; color: #53fc18; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #53fc18; border-radius: 5px; padding: 5px 12px; transition: background .15s; }
        .url-newtab:hover { background: rgba(83,252,24,0.1); color: #7aff4a; }
        #result > p { color: #555; font-size: 0.79rem; margin: 6px 0 0; }

        /* Setup */
        .setup-section { margin-bottom: 32px; }
        .steps { list-style: none; padding: 0; margin: 0; counter-reset: s; }
        .steps li { counter-increment: s; display: flex; gap: 10px; align-items: flex-start; margin-bottom: 9px; font-size: 0.87rem; color: #909090; line-height: 1.5; }
        .steps li::before { content: counter(s); background: #232323; border: 1px solid #53fc18; border-radius: 50%; min-width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; color: #53fc18; flex-shrink: 0; margin-top: 1px; }
        .steps li strong { color: #d8d8d8; }

        /* Footer */
        footer { border-top: 1px solid #252525; padding: 20px 0; text-align: center; font-size: 0.79rem; color: #444; margin-top: 20px; }
        footer p { margin: 4px 0; }
        footer a { color: #53fc18; }
      `}</style>

      <div className="page">

        {/* Header */}
        <header>
          <img src="/kick-logo.gif" alt="Kick" className="header-logo" />
          <h1 className="header-title">kickchat-gxufy</h1>
          <p className="header-sub">Setup</p>
        </header>

        {/* Commands */}
        <div className="commands-section">
          <p className="section-title">Chat Commands</p>
          <table className="cmd-table">
            <thead><tr><th>Command</th><th>Description</th><th>Access</th></tr></thead>
            <tbody>
              <tr><td>!kickchat ping</td><td>Shows a &ldquo;Pong!&rdquo; notification on screen</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!kickchat reload</td><td>Reloads the browser source</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!kickchat stop</td><td>Clears all active overlays</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!kickchat show / hide</td><td>Shows or hides the chat</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!kickchat refresh emotes</td><td>Reloads 7TV emotes without a page refresh</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!kickchat img [url or 7TV emote] -t [sec] -o [opacity]</td><td>Fullscreen image or 7TV emote (e.g. GIGACHAD). Use <code style={{color:'#53fc18'}}>img clear</code> to dismiss</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!kickchat yt [url or preset] -t [sec] -m</td><td>Fullscreen YouTube video. Presets: bruh, vine-boom, rickroll, dc-ping, win-error. Add <code style={{color:'#53fc18'}}>-m</code> to mute</td><td className="cmd-access">Mod+</td></tr>
              <tr><td>!kickchat tts [message]</td><td>Text-to-speech using the system voice built into OBS</td><td className="cmd-access">Mod+</td></tr>
            </tbody>
          </table>
        </div>

        {/* Generator form */}
        <form name="generator" onSubmit={e => { e.preventDefault(); copy(); }}>

          <div className="form_row center">
            <input type="text" name="channel" placeholder="Channel name"
              value={channel} onChange={e => setChannel(e.target.value)} required />
          </div>

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
                    .pc { margin-right:${psz.cmr}; }
                    .pe { max-height:${psz.eh}; max-width:${psz.ew}; height:auto; width:auto; vertical-align:middle; display:inline-block; margin-right:-3px; }
                  `}</style>
                  {PREV_MSGS.map((m, i) => (
                    <div key={i} style={{
                      lineHeight: psz.lh,
                    }}>
                      {!hideNames && (
                        <span style={{ display:'inline-block' }}>
                          {m.badges.map((b, bi) => (
                            <img key={bi} className="pb" src={b.src} alt={b.alt} />
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

        {/* OBS Setup */}
        <div className="setup-section">
          <p className="section-title">OBS Setup</p>
          <ol className="steps">
            <li>Enter your channel name, tweak your options, then click <strong>Generate &amp; Copy</strong></li>
            <li>In OBS: <strong>Add Source → Browser Source</strong></li>
            <li>Paste the URL and set your preferred size — my personal favorite is <strong>680 × 280</strong></li>
          </ol>
        </div>

      </div>

      <footer>
        <p>kickchat-gxufy with 🕊️ — <a href="https://x.com/Gxufy_" target="_blank" rel="noreferrer">https://x.com/Gxufy_</a></p>
        <p>Inspired by <a href="https://chatis.is2511.com/" target="_blank" rel="noreferrer">ChatIS</a> by IS2511 &amp; giambaJ</p>
        <p>This application is not affiliated with <a href="https://kick.com" target="_blank" rel="noreferrer">Kick</a></p>
      </footer>
    </>
  );
}
