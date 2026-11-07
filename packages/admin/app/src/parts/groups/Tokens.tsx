import house from '../../design/skins/house.css?raw'
import { blockAfter, coloursIn, declarations, ratio } from '../../design/skins/read.ts'

/** The house skin's values, read from its own source the way the skin tests read it: nothing here is
 *  typed twice, so the page cannot drift from the skin. */
const LIGHT = declarations(blockAfter(house, ':root[data-skin="house"] {'))
const DARK = coloursIn(house, 'house', 'dark')

/** What each colour is for (spec §3.2), in the spec's order; a colour the skin adds later still shows. */
const ROLE: Record<string, string> = {
  paper: 'page, sidebar', raised: 'surfaces: lists, cards, nodes', pop: 'menus, palette, sheets', sunken: 'wells, map canvas',
  wash: 'hover, chips', 'wash-strong': 'chip hover · ink text only', rule: 'hairline · decoration', 'rule-strong': 'outlines · decoration',
  edge: 'inputs, map edges', ink: 'text', mute: 'secondary text', faint: 'tertiary text', accent: 'moss · selected, staged, yours',
  'accent-soft': 'selected ring, “you”', 'on-accent': 'text on moss or clay', attn: 'clay · needs you', 'attn-soft': 'attention tile',
  solid: 'primary button, today', 'on-solid': 'text on solid', focus: 'focus ring', 'map-dot': 'map grid · decoration',
}
const isHex = (v: string | undefined) => v !== undefined && /^#[0-9a-f]{6}$/i.test(v)
const COLOURS = [...Object.keys(ROLE), ...Object.keys(LIGHT).filter(n => !(n in ROLE))].filter(n => isHex(LIGHT[n]))
const onPaper = (hex: string | null | undefined, paper: string | null | undefined) => (hex && paper ? ratio(hex, paper).toFixed(2) : '—')

const SPACE = Array.from({ length: 16 }, (_, i) => `sp-${i + 1}`)
const CORNERS: [token: string, label: string][] = [['radius-xs', 'xs'], ['radius-sm', 'sm'], ['radius-ctl', 'ctl'], ['radius', ''], ['radius-pop', 'pop'], ['radius-lg', 'lg'], ['radius-plate', 'plate']]
const px = (token: string) => (LIGHT[token] ?? '').replace(/px$/, '')
const MOTION: [token: string, words: string][] = [
  ['dur-1', 'hover, row, tab'], ['dur-press', 'press · scale .96'], ['dur-2', 'menu, palette, tray'],
  ['dur-3', 'sheet, inspector, camera'], ['dur-flow', '× 3 runs, then still'], ['ease', 'everything but press'],
]

/** /parts/tokens: the house skin's colours (with their measured contrast on paper), the type scale set
 *  in its own tokens, space, corners, the four depth levels and the motion tokens as words. Nothing on
 *  it moves. */
export default function Tokens() {
  return (
    <div className="tk">
      <p className="tk-lede">Every value an element draws is a token; the Hub’s look is the default token set (skin <code>{'house'}</code>). Colours are opaque hex so the contrast test can measure them; each ratio here is against paper, light · dark (spec §3.2).</p>

      <section className="tk-part" aria-label="Colour">
        <h2 className="tk-h">Colour <span>{COLOURS.length} tokens · light | dark · ratio on paper</span></h2>
        <ul className="tk-sws">
          {COLOURS.map(n => (
            <li key={n} className="tk-sw" data-token={n}>
              <svg className="tk-chip" viewBox="0 0 2 1" preserveAspectRatio="none" aria-hidden="true">
                <rect width="1" height="1" fill={LIGHT[n]} /><rect x="1" width="1" height="1" fill={DARK[n] ?? undefined} />
              </svg>
              <span className="tk-sw-t"><b>--{n}</b> {LIGHT[n]} · {DARK[n]}<span className="tk-role"> · {ROLE[n] ?? ''}</span></span>
              <span className="tk-r">{n === 'paper' ? '—' : `${onPaper(LIGHT[n], LIGHT.paper)} · ${onPaper(DARK[n], DARK.paper)}`}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="tk-part" aria-label="Type">
        <h2 className="tk-h">Type <span>Fraunces display · Geist interface · Geist Mono for anything copyable</span></h2>
        <dl className="tk-type">
          <dt>door hero · Fraunces 350<br />40→76 / 1.02 / −.025em</dt>
          <dd><span className="tk-hero">Practised <em>together.</em></span></dd>
          <dt>door section · Fraunces 350<br />28→36 / 1.1 / −.02em</dt>
          <dd><span className="tk-dsec">What we fund</span></dd>
          <dt>door lead · Fraunces 400<br />19→22 / 1.45</dt>
          <dd><span className="tk-lead">Two grant pools on Gardens, where members signal with conviction.</span></dd>
          <dt>home line · Fraunces 400<br />28 / 1.15 / −.015em</dt>
          <dd><span className="tk-greet">Three things wait on you.</span></dd>
          <dt>page title · Geist 600<br />24 / 1.25 / −.015em</dt>
          <dd><span className="tk-title">Return the Gardens pools to the treasury</span></dd>
          <dt>body · Geist 400/500<br />14 / 1.5 · row title 500</dt>
          <dd className="tk-body"><b>Treasury</b> <span>— one Safe at the same address on seven chains. Any four of eight signers move funds.</span></dd>
          <dt>prose · Geist 400<br />16 / 1.65 · 68ch</dt>
          <dd><p className="tk-prose">The two community pools hold funds that have sat unallocated. This page records why the Council asked to return them, and what happens next.</p></dd>
          <dt>meta · Geist 400<br />13 / 1.35 · label 12/500</dt>
          <dd><span className="tk-meta">Opened 28 Sep 2026 by a steward · Council consent</span></dd>
          <dt>copyable · Geist Mono 400/500<br />12.5 · tabular · slashed zero</dt>
          <dd><span className="tk-code">eip155:42220:0x6AFFe5105DE869fE4A27b3353468eFb51a55343a</span></dd>
          <dt>eyebrow · Geist Mono 500<br />11 / upper / .08em</dt>
          <dd><span className="tk-eyebrow">Read from its own records · 4 min ago</span></dd>
        </dl>
      </section>

      <section className="tk-part" aria-label="Space, corners, depth, motion">
        <h2 className="tk-h">Space, corners, depth, motion</h2>
        <div className="tk-grid">
          <section className="tk-card" aria-label="Space">
            <h3 className="tk-cap">space · --sp-1 … --sp-18</h3>
            <ul className="tk-scale">
              {SPACE.map(t => <li key={t}><i style={{ width: `var(--${t})`, height: `var(--${t})` }} />{px(t)}</li>)}
            </ul>
            <p className="tk-note">--sp-17 {px('sp-17')} and --sp-18 {px('sp-18')}: the door’s rhythm only.</p>
          </section>
          <section className="tk-card" aria-label="Corners">
            <h3 className="tk-cap">corners</h3>
            <ul className="tk-radii">
              {CORNERS.map(([t, label]) => <li key={t}><i data-r={t} />{label ? `${label} ${px(t)}` : px(t)}</li>)}
            </ul>
          </section>
          <section className="tk-card" aria-label="Depth">
            <h3 className="tk-cap">depth</h3>
            <ul className="tk-depths">
              <li data-depth="flat">flat · rule</li>
              <li data-depth="card">card</li>
              <li data-depth="raise">raise · node</li>
              <li data-depth="pop">pop · menu</li>
            </ul>
          </section>
          <section className="tk-card" aria-label="Motion">
            <h3 className="tk-cap">motion</h3>
            <dl className="tk-motion">
              {MOTION.map(([t, words]) => <div key={t}><dt>--{t}</dt><dd>{LIGHT[t]} · {words}</dd></div>)}
            </dl>
          </section>
        </div>
      </section>
    </div>
  )
}
