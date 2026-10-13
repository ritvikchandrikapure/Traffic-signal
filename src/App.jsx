import { useEffect, useReducer, useRef, useState } from 'react'
import './App.css'

/* ---------- constants ---------- */
const DIRS = ['N', 'E', 'S', 'W'] // arm the traffic comes FROM
const NAME = { N: 'North', E: 'East', S: 'South', W: 'West' }
// One road at a time: green -> yellow -> all-red, then the next road gets its turn
const PHASES = DIRS.flatMap((g) => [
  { g, k: 'green' }, { g, k: 'yellow' }, { g: '-', k: 'red' },
])
const LINE = 194, GAP = 14, BRAKE = 240 // vehicles stop BEHIND the zebra crossing
const BLD = [[16, 16, 110, 86, '#cdb9a5'], [470, 16, 110, 120, '#b6c3d1'], [16, 480, 120, 100, '#d6c9b3'], [470, 470, 110, 110, '#bccabd']]
const TREES = [[56, 150, 36], [28, 196, 24], [520, 185, 38], [560, 158, 26], [58, 400, 38], [100, 442, 24], [520, 420, 38], [560, 398, 28]]

/* ---------- vehicle types: size (len x w) and speed differ ---------- */
const TYPES = {
  car:   { len: 40, w: 24, max: 130, acc: 200 },
  bike:  { len: 30, w: 14, max: 160, acc: 280 },
  auto:  { len: 32, w: 21, max: 105, acc: 170 },
  bus:   { len: 84, w: 29, max: 90,  acc: 90 },
  truck: { len: 68, w: 28, max: 80,  acc: 80 },
  amb:   { len: 46, w: 25, max: 175, acc: 320 },
}
const PALETTE = {
  car: ['#e8b04a', '#d9544d', '#3d7ea6', '#e9ecef', '#5fa86f', '#7a6bb0'],
  bike: ['#e5383b', '#2563eb', '#16a34a', '#f59e0b'],
  auto: ['#f2c230', '#f2c230', '#2e9e5b'],
  bus: ['#c2410c', '#2563eb', '#0f766e'],
  truck: ['#e8b04a', '#4f7cac', '#7b8794'],
  amb: ['#ffffff'],
}
const rnd = (a) => a[Math.floor(Math.random() * a.length)]
const pickType = () => {
  const r = Math.random()
  return r < 0.32 ? 'car' : r < 0.64 ? 'bike' : r < 0.8 ? 'auto' : r < 0.88 ? 'bus' : 'truck'
}
const pickRoute = (type) => {
  const r = Math.random()
  if (type === 'amb') return 'S'
  if (type === 'bus' || type === 'truck') return r < 0.85 ? 'S' : 'L' // big vehicles: no tight U/right turns
  return r < 0.5 ? 'S' : r < 0.72 ? 'L' : r < 0.92 ? 'R' : 'U'
}
const makeCar = (id, d, forced) => {
  const type = forced || pickType()
  return { id, d, type, ...TYPES[type], route: pickRoute(type), s: 0, v: 90, wait: 0,
    held: false, counted: false, braking: false, color: rnd(PALETTE[type]) }
}

/* Green time follows that road's traffic: 6s (empty) up to 60s (jammed) */
function phaseDur(i, dens) {
  const p = PHASES[i]
  if (p.k === 'yellow') return 3
  if (p.k === 'red') return 3 // all-red gap: turning cars clear the junction
  return 6 + Math.round((dens[p.g] / 100) * 54)
}

const signal = (d, s, emergency) =>
  emergency ? 'red' : PHASES[s.phase].g === d ? PHASES[s.phase].k : 'red'

function waitUntil(test, s, dens) {
  let i = s.phase, rem = s.dur - s.t, w = 0
  for (let n = 0; n < PHASES.length; n++) {
    if (test(PHASES[i])) return w
    w += rem
    i = (i + 1) % PHASES.length
    rem = phaseDur(i, dens)
  }
  return w
}

const waitFor = (d, s, dens) => waitUntil((q) => q.g === d && q.k === 'green', s, dens)

const fmt = (n) => (n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : `${n}`)

/* ---------- routes: straight, left, right, U-turn (left-hand traffic) ----------
   Paths are written for the North arm (heading south), then rotated for E, S, W. */
const LA = 20 * Math.PI // quarter circle, radius 40
const TURN = { L: [220, LA], R: [300, LA], U: [240, 2 * LA] } // [arc start, arc length]
const QUARTER = { N: 0, E: 1, S: 2, W: 3 }

function canon(route, u) {
  if (route === 'S') return [340, u, 0, 1]
  if (route === 'L') {
    if (u <= 220) return [340, u, 0, 1]
    if (u <= 220 + LA) {
      const th = Math.PI - (u - 220) / 40
      return [380 + 40 * Math.cos(th), 220 + 40 * Math.sin(th), Math.sin(th), -Math.cos(th)]
    }
    return [380 + (u - 220 - LA), 260, 1, 0]
  }
  if (route === 'R') {
    if (u <= 300) return [340, u, 0, 1]
    if (u <= 300 + LA) {
      const th = (u - 300) / 40
      return [300 + 40 * Math.cos(th), 300 + 40 * Math.sin(th), -Math.sin(th), Math.cos(th)]
    }
    return [300 - (u - 300 - LA), 340, -1, 0]
  }
  if (u <= 240) return [340, u, 0, 1]
  if (u <= 240 + 2 * LA) {
    const th = (u - 240) / 40
    return [300 + 40 * Math.cos(th), 240 + 40 * Math.sin(th), -Math.sin(th), Math.cos(th)]
  }
  return [260, 240 - (u - 240 - 2 * LA), 0, -1]
}

function pose(c) {
  let [x, y, hx, hy] = canon(c.route, c.s - c.len / 2)
  x -= 300; y -= 300
  for (let k = 0; k < QUARTER[c.d]; k++) { [x, y] = [-y, x]; [hx, hy] = [-hy, hx] }
  return [300 + x, 300 + y, (Math.atan2(hx, -hy) * 180) / Math.PI]
}

// slow down smoothly before the bend, crawl through it
function turnLimit(c) {
  const t = TURN[c.route]
  if (!t) return Infinity
  const u = c.s - c.len / 2, vt = Math.min(c.max, c.route === 'U' ? 70 : 85)
  if (u < t[0]) return Math.sqrt(vt * vt + 2 * BRAKE * (t[0] - u))
  return u < t[0] + t[1] + 10 ? vt : Infinity
}

/* ---------- simulation ---------- */
const makeSim = (dens) => ({
  phase: 0, t: 0, dur: phaseDur(0, dens), cars: [], id: 1,
  pending: [], prio: null, hadPrio: false,
  stats: { cleared: 0, held: 0, maxWait: 0 },
})

function step(s, rawDt, c) {
  if (c.paused) return
  const dt = rawDt * c.speed

  /* Ambulance priority: the road of a waiting / still-crossing ambulance gets green */
  const live = s.cars.find((x) => x.type === 'amb' && x.s - x.len < 392)
  const prio = c.emergency ? null : s.pending[0] ?? live?.d ?? null
  s.prio = prio

  if (!c.emergency) {
    let p = PHASES[s.phase]
    if (prio) {
      s.hadPrio = true
      // cut the current green short: 2s yellow, then the normal all-red gap
      if (p.k === 'green' && p.g !== prio) { s.phase++; s.t = 0; s.dur = 2; p = PHASES[s.phase] }
    } else if (s.hadPrio) {
      s.hadPrio = false
      if (p.k === 'green') s.dur = Math.min(s.dur, s.t + 4) // resume normal cycle soon
    }
    const holding = prio && p.k === 'green' && p.g === prio // keep green until it has crossed
    if (!holding) s.t += dt
    if (s.t >= s.dur) {
      let nxt = (s.phase + 1) % PHASES.length
      if (prio && p.k === 'red') nxt = DIRS.indexOf(prio) * 3 // jump to the ambulance road
      s.phase = nxt
      s.t = 0
      s.dur = phaseDur(nxt, c.dens)
    }
  }

  // an ambulance enters as soon as there is space in its lane
  for (let i = s.pending.length - 1; i >= 0; i--) {
    const d = s.pending[i]
    if (s.cars.every((x) => x.d !== d || x.s - x.len > GAP + 8)) {
      s.cars.push(makeCar(s.id++, d, 'amb'))
      s.pending.splice(i, 1)
    }
  }

  for (const d of DIRS) {
    const st = signal(d, s, c.emergency)
    const list = s.cars.filter((x) => x.d === d).sort((a, b) => b.s - a.s)
    list.forEach((car, i) => {
      const ahead = list[i - 1]
      let limit = Infinity
      if (car.s <= LINE + 3 && st !== 'green') limit = LINE // stop at the line
      if (ahead) limit = Math.min(limit, ahead.s - ahead.len - GAP) // safe gap
      const gap = Math.max(0, limit - car.s)
      const vmax = Math.min(car.max, Math.sqrt(2 * BRAKE * gap), turnLimit(car))
      car.v = Math.min(car.v + car.acc * dt, vmax)
      car.s += Math.min(car.v * dt, gap)
      car.braking = car.v < car.max * 0.6 && (car.s <= LINE + 3 || !!ahead)
      if (car.v < 5 && car.s <= LINE + 3) {
        car.wait += dt
        if (st === 'red' && !car.held) { car.held = true; s.stats.held++ }
      }
      if (car.s > LINE + 10 && !car.counted) {
        car.counted = true
        s.stats.maxWait = Math.max(s.stats.maxWait, car.wait)
      }
    })
    const rate = 0.15 + (c.dens[d] / 100) * 0.85
    if (Math.random() < rate * dt && list.length < 9 && !list.some((x) => x.s - x.len < 24)) {
      s.cars.push(makeCar(s.id++, d))
    }
  }
  const before = s.cars.length
  s.cars = s.cars.filter((x) => x.s < 730)
  s.stats.cleared += before - s.cars.length
}

/* two-tone siren (Web Audio) */
function useSiren(on) {
  useEffect(() => {
    if (!on) return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = 700
    gain.gain.value = 0.04
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    let hi = false
    const id = setInterval(() => {
      hi = !hi
      osc.frequency.setTargetAtTime(hi ? 960 : 700, ctx.currentTime, 0.03)
    }, 450)
    return () => { clearInterval(id); osc.stop(); ctx.close() }
  }, [on])
}

/* ---------- UI ---------- */
const level = (v) => (v < 30 ? 'Light' : v < 70 ? 'Moderate' : 'Heavy')
const WORD = { green: 'GO', yellow: 'SLOW', red: 'STOP' }

function Head({ d, st, secs, prio }) {
  const text = secs == null ? (prio ? WORD[st] : '–') : fmt(secs)
  return (
    <div className={`head h-${d}`} aria-label={`${NAME[d]} signal ${st}`}>
      <small>{d}</small>
      {['red', 'yellow', 'green'].map((c) => (
        <i key={c} className={`lamp ${c} ${st === c ? 'on' : ''}`} />
      ))}
      <b key={text} className={`count ${st}`}>{text}</b>
    </div>
  )
}

export default function App() {
  const [dens, setDens] = useState({ N: 45, E: 45, S: 45, W: 45 })
  const [speed, setSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [emergency, setEmergency] = useState(false)
  const [sound, setSound] = useState(true)
  const [sheet, setSheet] = useState(false)
  const ctl = useRef({})
  ctl.current = { dens, speed, paused, emergency }
  const sim = useRef(null)
  if (!sim.current) sim.current = makeSim(dens)
  const [, force] = useReducer((x) => x + 1, 0)

  const box = useRef(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      setScale(Math.max(0.3, Math.min(1.5, width / 600, height / 600)))
    })
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let raf, last = performance.now()
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      step(sim.current, dt, ctl.current)
      if (!ctl.current.paused) force()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const s = sim.current
  const prio = emergency ? null : s.prio
  useSiren(!!prio && sound && !paused)

  const p = PHASES[s.phase]
  const left = Math.ceil(s.dur - s.t)
  const info = DIRS.map((d) => {
    const st = signal(d, s, emergency)
    const secs = emergency || prio ? null : st === 'red' ? Math.ceil(waitFor(d, s, dens)) : left
    return { d, st, secs, prio }
  })
  const nowSt = emergency ? 'red' : p.k
  const next = prio || PHASES[(s.phase + 1) % PHASES.length].g
  const crossing = prio && p.g === prio && p.k === 'green'
  const who = emergency ? 'All roads stopped'
    : prio ? (crossing ? `Ambulance crossing · ${NAME[prio]} road` : `Ambulance coming · clearing ${NAME[prio]} road`)
    : p.g === '-' ? `Clearing junction · next ${NAME[next]}`
    : `${NAME[p.g]} road · ${p.k === 'green' ? 'go' : 'slow down'}`

  const busy = new Set([...s.pending, ...s.cars.filter((x) => x.type === 'amb').map((x) => x.d)])
  const callAmb = (d) => { if (!busy.has(d)) s.pending.push(d) }
  const reset = () => { sim.current = makeSim(dens); setEmergency(false); setPaused(false) }

  return (
    <div className="app">
      <div className="stageBox" ref={box}>
        <div className="frame" style={{ width: 600 * scale, height: 600 * scale }}>
          <div className="stage" style={{ transform: `scale(${scale})` }}>
            {BLD.map(([x, y, w, h, c], i) => <div key={i} className="bld" style={{ left: x, top: y, width: w, height: h, background: c }} />)}
            {TREES.map(([x, y, d], i) => <div key={i} className="tree" style={{ left: x - d / 2, top: y - d / 2, width: d, height: d }} />)}
            <i className="walk wv1" /><i className="walk wv2" /><i className="walk wh1" /><i className="walk wh2" />
            <div className="road v" /><div className="road h" /><div className="core" />
            <i className="zebra zt" /><i className="zebra zb" /><i className="zebra zl" /><i className="zebra zr" />
            <i className="stop st-N" /><i className="stop st-S" /><i className="stop st-W" /><i className="stop st-E" />
            {s.cars.map((c) => {
              const [x, y, r] = pose(c)
              const tr = TURN[c.route]
              const blink = tr && c.s - c.len / 2 < tr[0] + tr[1] - 10 ? (c.route === 'L' ? 'tl' : 'tr') : ''
              return (
                <div key={c.id} className={`car v-${c.type} ${c.braking ? 'brake' : ''} ${blink}`}
                  style={{ '--c': c.color, width: c.w, height: c.len,
                    transform: `translate(${x - c.w / 2}px,${y - c.len / 2}px) rotate(${r}deg)` }}>
                  <i className="hl l" /><i className="hl r" /><i className="ind l" /><i className="ind r" />
                  {c.type === 'amb' && <><i className="bc l" /><i className="bc r" /></>}
                </div>
              )
            })}
            {info.map((i) => <Head key={i.d} {...i} />)}
            {emergency && <div className="flash" />}
            {prio && <><div className="flash amb" /><div className="ambBanner">Ambulance priority · {NAME[prio]} road</div></>}
          </div>
        </div>
      </div>

      <aside className="side">
        <header>
          <h1>Four-Way Junction</h1>
          <p>One road at a time. Vehicles stop behind the zebra crossing.</p>
        </header>

        <section className={`now ${nowSt}`}>
          <div className="who">{who}</div>
          <div className={`big ${prio ? 'txt' : ''}`} key={prio ? 'p' : left}>{emergency ? '–' : prio ? 'Priority' : fmt(left)}</div>
          <div className="bar"><div style={{ width: `${emergency || prio ? 100 : (1 - s.t / s.dur) * 100}%` }} /></div>
          <div className="order">
            {DIRS.map((d) => (
              <span key={d} className={!emergency && p.g === d ? `on ${p.k}` : !emergency && p.g === '-' && next === d ? 'next' : ''}>
                {NAME[d]}
              </span>
            ))}
          </div>
        </section>

        <section className="notices">
          {info.map(({ d, st, secs }) => (
            <div key={d} className={`notice ${st}`}>
              <span className="dot" />
              <strong>{NAME[d]}</strong>
              <em>
                {emergency ? 'Hold'
                  : prio ? (d === prio ? (st === 'green' ? 'Go · ambulance' : 'Next · ambulance') : 'Stop · ambulance')
                  : st === 'green' ? `Go · ${fmt(secs)}s left`
                  : st === 'yellow' ? `Slow · ${secs}s` : `Wait ${fmt(secs)}s`}
              </em>
            </div>
          ))}
        </section>

        <section className={`traffic ${sheet ? 'open' : ''}`}>
          <h3>Traffic frequency</h3>
          {DIRS.map((d) => (
            <label key={d} className="slider">
              <span>{NAME[d]}</span>
              <input type="range" min="0" max="100" value={dens[d]}
                onChange={(e) => setDens({ ...dens, [d]: +e.target.value })} />
              <em>{level(dens[d])}</em>
            </label>
          ))}
          <p className="hint">Busier road = longer green (6 to 60 seconds).</p>
          <button className="only-m close" onClick={() => setSheet(false)}>Done</button>
        </section>

        <section className="amb">
          <h3>Ambulance from</h3>
          <div className="seg">
            {DIRS.map((d) => (
              <button key={d} disabled={busy.has(d)} title={`Send an ambulance from ${NAME[d]}`}
                aria-label={`Send an ambulance from ${NAME[d]}`} onClick={() => callAmb(d)}>{d}</button>
            ))}
          </div>
          <button className={sound ? 'tgl act' : 'tgl'} onClick={() => setSound(!sound)}>Siren {sound ? 'on' : 'off'}</button>
        </section>

        <section className="controls">
          <div className="seg">
            {[1, 2, 4].map((v) => (
              <button key={v} className={speed === v ? 'act' : ''} onClick={() => setSpeed(v)}>{v}×</button>
            ))}
          </div>
          <button onClick={() => setPaused(!paused)}>{paused ? 'Resume' : 'Pause'}</button>
          <button className="only-m" onClick={() => setSheet(true)}>Traffic</button>
          <button className={`danger ${emergency ? 'act' : ''}`} onClick={() => setEmergency(!emergency)}>
            {emergency ? 'Release' : 'Emergency'}
          </button>
          <button onClick={reset}>Reset</button>
        </section>

        <section className="stats">
          <div><b>{s.stats.cleared}</b><span>Cleared</span></div>
          <div><b>{s.stats.held}</b><span>At red</span></div>
          <div><b>{Math.round(s.stats.maxWait)}s</b><span>Max wait</span></div>
          <div className="safe"><b>0</b><span>Collisions</span></div>
        </section>
      </aside>
    </div>
  )
}
