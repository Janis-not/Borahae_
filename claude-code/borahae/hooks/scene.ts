// The dressing room as one picture: the room drawn by generar_camerino.py, the free
// members asleep on its floor, each with an arcade name plate over its head.
// The module has no zlib: the PNG is indexed colour with stored (uncompressed) deflate.
import { DANCERS, FLOOR_Y, PALETTE, ROOM, ROOM_H, ROOM_W, SLEEPERS, STARS } from './camerino'

export type Sleeper = { id: string; name: string; state: 'rest' | 'done' | 'error' }

/** Rows : columns the picture wants, from its pixel shape (a cell is twice as tall as wide). */
export const SCENE_COLS_PER_ROW = Math.round((2 * ROOM_W) / ROOM_H)

// ── base64 ──────────────────────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const fromB64 = (s: string): Uint8Array => {
  const clean = s.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let acc = 0
  let o = 0
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out
}
const toB64 = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    s += i + 1 < b.length ? B64[(n >> 6) & 63]! : '='
    s += i + 2 < b.length ? B64[n & 63]! : '='
  }
  return s
}

// ── PNG (colour type 3, 8 bit, stored deflate) ──────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (parts: Uint8Array[]) => {
  let c = 0xffffffff
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
const ascii = (s: string) => new Uint8Array(Array.from(s, c => c.charCodeAt(0)))
const chunk = (tag: string, data: Uint8Array) => {
  const t = ascii(tag)
  return [u32(data.length), t, data, u32(crc32([t, data]))]
}
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const zlibStored = (raw: Uint8Array) => {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])]
  for (let i = 0; i < raw.length || i === 0; i += 65535) {
    const block = raw.subarray(i, Math.min(raw.length, i + 65535))
    const last = i + 65535 >= raw.length ? 1 : 0
    const len = block.length
    parts.push(new Uint8Array([last, len & 255, len >> 8, ~len & 255, (~len >> 8) & 255]), block)
  }
  let a = 1
  let b = 0
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]!) % 65521
    b = (b + a) % 65521
  }
  parts.push(u32(((b << 16) | a) >>> 0))
  return concat(parts)
}
const PLTE = (() => {
  const p = new Uint8Array((PALETTE.length + 1) * 3)
  PALETTE.forEach((hex, i) => {
    const n = parseInt(hex.slice(1), 16)
    p.set([(n >> 16) & 255, (n >> 8) & 255, n & 255], (i + 1) * 3)
  })
  return p
})()
const encodePng = (px: Uint8Array, w: number, h: number) => {
  const raw = new Uint8Array((w + 1) * h)
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w, (y + 1) * w), y * (w + 1) + 1)
  const ihdr = concat([u32(w), u32(h), new Uint8Array([8, 3, 0, 0, 0])])
  return toB64(
    concat([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ...chunk('IHDR', ihdr),
      ...chunk('PLTE', PLTE),
      ...chunk('IDAT', zlibStored(raw)),
      ...chunk('IEND', new Uint8Array(0)),
    ]),
  )
}

// ── Arcade font, 3x5 ────────────────────────────────────────────────────
const FONT: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101110100110101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', '0': '111101101101111', '1': '010110010010111',
  '2': '110001010100111', '3': '110001010001110', '4': '101101111001001', '5': '111100110001110',
  '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
  '×': '000101010101000', ' ': '000000000000000',
}
const Z_GLYPH = ['1111', '0010', '0100', '1111']

const colour = (hex: string) => PALETTE.indexOf(hex) + 1
const INK = colour('#1c1030')
const PLATE: Record<Sleeper['state'], number> = {
  rest: colour('#a374db'),
  done: colour('#2faf6b'),
  error: colour('#e8423a'),
}
const WHITE = colour('#ffffff')
const LILAC = colour('#d6b4fc')
const CREAM = colour('#fff6d6')

const room = fromB64(ROOM)
const sprites = Object.fromEntries(
  Object.entries(SLEEPERS).map(([id, s]) => [id, { ...s, px: [fromB64(s.frames[0]), fromB64(s.frames[1])] as const }]),
)
const fold = (name: string) =>
  Array.from(name.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
    .map(c => (FONT[c] ? c : ' '))
    .slice(0, 9)

const cache = new Map<string, string>()

/**
 * The room with these members asleep on its floor. `phase` moves the stars, the
 * breathing and the floating z; one picture per distinct scene is kept.
 */
export const scenePng = (sleepers: readonly Sleeper[], phase: number): string => {
  const key = `${phase % 6}|${sleepers.map(s => `${s.id}:${s.name}:${s.state}`).join(',')}`
  const hit = cache.get(key)
  if (hit) return hit

  const W = ROOM_W
  const H = ROOM_H
  const px = room.slice()
  const put = (x: number, y: number, c: number) => {
    if (c > 0 && x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = c
  }

  // Twinkling sparkles in the night sky: a dot, then a cream four-point star on its bright beat.
  STARS.forEach(([x, y], i) => {
    const on = (phase + i) % 3
    if (on === 0) return
    put(x, y, on === 2 ? CREAM : WHITE)
    if (on === 2) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        put(x + dx, y + dy, CREAM)
        if (i % 2 === 0) put(x + 2 * dx, y + 2 * dy, WHITE)
      }
    }
  })

  const n = sleepers.length
  sleepers.forEach((s, i) => {
    const sp = sprites[s.id]
    if (!sp) return
    const cx = Math.round((W * (i + 0.5)) / n)
    const ox = cx - 16
    const oy = H - 3 - sp.bottom
    // Breathing: each sleeper on its own beat.
    const frame = sp.px[(phase + i) % 4 === 0 ? 1 : 0]
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) put(ox + x, oy + y, frame[y * 32 + x]!)

    // The arcade name plate over the head.
    const letters = fold(s.name)
    const textW = letters.length * 4 - 1
    const plateW = textW + 4
    let px0 = cx - Math.floor(plateW / 2)
    px0 = Math.max(0, Math.min(W - plateW, px0))
    // Crowded room: every other plate rides higher so the names never touch.
    const crowded = n * 34 > W || n >= 6
    const py0 = Math.max(FLOOR_Y - 20, oy + sp.top - 9 - (crowded && i % 2 === 1 ? 10 : 0))
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < plateW; x++) {
        const edge = y === 0 || y === 8 || x === 0 || x === plateW - 1
        const corner = (y === 0 || y === 8) && (x === 0 || x === plateW - 1)
        if (!corner) put(px0 + x, py0 + y, edge ? INK : PLATE[s.state])
      }
    letters.forEach((c, k) => {
      const g = FONT[c]!
      for (let r = 0; r < 5; r++)
        for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1') put(px0 + 2 + k * 4 + q, py0 + 2 + r, WHITE)
    })
    // A little pointer under the plate, like a player tag.
    for (let y = py0 + 9; y < oy + sp.top; y++) put(cx, y, INK)

    // The z floats up beside the plate while it sleeps.
    if (s.state === 'rest') {
      const rise = (phase + i * 2) % 3
      const zx = px0 + plateW + 5 <= W ? px0 + plateW + 1 : px0 - 5
      const zy = py0 + 4 - rise * 2
      Z_GLYPH.forEach((row, r) => Array.from(row).forEach((ch, q) => ch === '1' && put(zx + q, zy + r, LILAC)))
    }
  })

  const png = encodePng(px, W, H)
  if (cache.size > 60) cache.clear()
  cache.set(key, png)
  return png
}

// ── The stage banner: a strip of the same night sky, with the title in arcade letters ──
const SKY = colour('#5b4ba3')
const SKY_HI = colour('#6656b0')
const CLOUD = [colour('#b9a3e6'), colour('#a08ad8'), colour('#8571c4'), colour('#6f5eb6')] as const
const MOON = colour('#fff3b0')
const PURPLE_PLATE = colour('#a374db')

/** Same little hash for every phase, so the sky does not jump between frames. */
const rand = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0
    return s / 4294967296
  }
}

const drawCloud = (put: (x: number, y: number, c: number) => void, cx: number, cy: number, k: number, h: number) => {
  const blobs = [[-14, 0, 6], [-6, -4, 8], [5, -6, 9], [15, -2, 7], [23, 1, 5], [-20, 2, 4]].map(
    ([dx, dy, r]) => [cx + dx! * k, cy + dy! * k, r! * k] as const,
  )
  const base = cy + 3 * k
  const inside = (x: number, y: number) =>
    y <= base && blobs.some(([bx, by, r]) => (x - bx) ** 2 + ((y - by) * 1.15) ** 2 <= r * r)
  for (let y = Math.floor(cy - 20 * k); y <= Math.min(h - 1, Math.floor(base)); y++)
    for (let x = Math.floor(cx - 30 * k); x < cx + 32 * k; x++) {
      if (!inside(x, y)) continue
      const c = !inside(x, y - 2) || !inside(x - 1, y - 1)
        ? CLOUD[0]
        : y >= base - 1 || !inside(x, y + 2) ? CLOUD[3] : y >= base - 3 * k ? CLOUD[2] : CLOUD[1]
      put(x, y, c)
    }
}

const bannerCache = new Map<string, string>()

/**
 * The stage header as a picture `cols` × `rows` cells wide (4 × 8 pixels each): night
 * sky, clouds, a moon, sparkles that twinkle (faster when someone sings) and the title.
 */
export const stageBannerPng = (cols: number, rows: number, phase: number, live: boolean): string => {
  const key = `${cols}|${rows}|${phase % 6}|${live}`
  const hit = bannerCache.get(key)
  if (hit) return hit
  const W = Math.max(8, cols * 4)
  const H = Math.max(8, rows * 8)
  const px = new Uint8Array(W * H).fill(SKY)
  const put = (x: number, y: number, c: number) => {
    x = Math.round(x)
    y = Math.round(y)
    if (c > 0 && x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = c
  }
  for (let x = 0; x < W; x++) {
    put(x, 0, SKY_HI)
    put(x, 1, SKY_HI)
    if (x % 2 === 0) put(x, 2, SKY_HI)
  }
  const r = rand(W * 31 + H)
  // Star dust, some in little clusters like a scattered constellation.
  for (let i = 0; i < W / 5; i++) put(r() * W, r() * H, r() < 0.75 ? WHITE : CREAM)
  for (let c = 0; c < Math.max(2, Math.floor(W / 80)); c++) {
    const cx = r() * W
    const cy = r() * H
    for (let i = 0; i < 7; i++) put(cx + (r() - 0.5) * 18, cy + (r() - 0.5) * 10, WHITE)
  }

  // Big soft clouds drifting in from the edges, cut by the top and bottom like a window on the sky.
  const k = Math.max(0.6, H / 28)
  let top = r() < 0.5
  for (let cx = 12 + r() * 20; cx < W + 30; cx += 55 + r() * 35) {
    const cy = top ? 2 + r() * 4 : H + 1 - r() * 5
    drawCloud(put, cx, cy, k * (0.75 + r() * 0.45), H)
    top = !top
  }

  // Moon on the left.
  const mx = 11
  const my = Math.floor(H / 2)
  const mr = Math.min(7, Math.floor(H / 3))
  for (let y = my - mr; y <= my + mr; y++)
    for (let x = mx - mr; x <= mx + mr; x++)
      if ((x - mx) ** 2 + (y - my) ** 2 <= mr * mr && (x - mx - 4) ** 2 + (y - my + 2) ** 2 > (mr - 2) ** 2) put(x, y, MOON)

  // Title: white arcade letters with an ink outline, straight on the sky (no plate).
  const long = 'ESCENARIO BORAHAE'
  const scale = H >= 20 ? 2 : 1
  const text = Array.from(long.length * 4 * scale + 8 <= W - 30 ? long : 'BORAHAE')
  const tw = text.length * 4 * scale - scale
  const tx = Math.max(24, Math.floor((W - tw) / 2))
  const ty = Math.max(1, Math.floor((H - 5 * scale) / 2))
  const glyph = (ox: number, oy: number, c: number) =>
    text.forEach((ch, n) => {
      const g = FONT[ch] ?? FONT[' ']!
      for (let row = 0; row < 5; row++)
        for (let q = 0; q < 3; q++)
          if (g[row * 3 + q] === '1')
            for (let a = 0; a < scale; a++)
              for (let b = 0; b < scale; b++) put(ox + (n * 4 + q) * scale + b, oy + row * scale + a, c)
    })
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [2, 2]] as const) glyph(tx + dx, ty + dy, INK)
  glyph(tx + 1, ty + 1, PURPLE_PLATE)
  glyph(tx, ty, WHITE)

  // Sparkles over everything: on their bright beat a cream four-point star (bigger every other one).
  const speed = live ? 2 : 1
  const n = Math.max(5, Math.floor(W / 22))
  for (let i = 0; i < n; i++) {
    const x = 22 + r() * (W - 26)
    const y = 3 + r() * (H - 6)
    if (x > tx - 3 && x < tx + tw + 3 && y > ty - 3 && y < ty + 5 * scale + 3) continue
    const on = (phase * speed + i) % 3
    if (on === 0) continue
    put(x, y, on === 2 ? CREAM : WHITE)
    if (on === 2) {
      const arm = i % 2 === 0 ? 2 : 1
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
        for (let d = 1; d <= arm; d++) put(x + dx * d, y + dy * d, d < arm ? CREAM : WHITE)
    }
  }

  const png = encodePng(px, W, H)
  if (bannerCache.size > 40) bannerCache.clear()
  bannerCache.set(key, png)
  return png
}

// ── The stage: a night stadium concert drawn live, with whoever works dancing on it ──
// Sky after the user's reference fondo1 (violet night, lilac clouds, sparkles); a ring
// of glowing bulbs, LED screens, sparkle fountains, a crowd with lightsticks. All drawn
// here, original: a heart in the middle, our own chibis on the screens.
export type Dancer = { id: string; name: string }

const STAGE_W = 240
const STAGE_H = 96
/** Rows : columns the stage picture wants (a cell is twice as tall as wide). */
export const STAGE_COLS_PER_ROW = Math.round((2 * STAGE_W) / STAGE_H)

const S = {
  sky: [colour('#16124a'), colour('#241c6e'), colour('#3a2a8a'), colour('#5a3aac'), colour('#7a4ac8')] as const,
  cyan: colour('#7fe8ff'),
  bulb: colour('#e8fbff'),
  spark: colour('#fffbe8'),
  truss: colour('#3a3448'),
  trussHi: colour('#5a5470'),
  screen: colour('#2a2050'),
  mesh: colour('#4a3a80'),
  heart: [colour('#ffb3ee'), colour('#ff7ad9'), colour('#d84fb8')] as const,
  crowd: colour('#120c2a'),
  rim: colour('#8a6ae0'),
  deck: colour('#5a3aac'),
  // Colours of the floating music notes.
  confetti: [colour('#ff6fc6'), colour('#7df0c4'), colour('#ffd76a'), colour('#9ad8ff'), colour('#ffb3ee')] as const,
}
const DECK_Y = 72
const NOTE_GLYPH = ['0110', '0101', '0100', '1100', '1100']
const dancerSprites = Object.fromEntries(
  Object.entries(DANCERS).map(([id, s]) => [id, { ...s, px: [fromB64(s.frames[0]), fromB64(s.frames[1])] as const }]),
)
const stageCache = new Map<string, string>()

/** An arcade plate with white letters (at `scale`), clamped inside the picture. */
const drawPlate = (
  put: (x: number, y: number, c: number) => void,
  W: number, cx: number, py0: number, name: string, fill: number, scale = 1,
) => {
  const letters = fold(name)
  const pw = letters.length * 4 * scale - scale + 4 * scale
  const ph = 5 * scale + 4 * scale
  const px0 = Math.max(0, Math.min(W - pw, cx - Math.floor(pw / 2)))
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const edge = y === 0 || y === ph - 1 || x === 0 || x === pw - 1
      const corner = (y === 0 || y === ph - 1) && (x === 0 || x === pw - 1)
      if (!corner) put(px0 + x, py0 + y, edge ? INK : fill)
    }
  letters.forEach((c, k) => {
    const g = FONT[c]!
    for (let rr = 0; rr < 5; rr++)
      for (let q = 0; q < 3; q++)
        if (g[rr * 3 + q] === '1')
          for (let a = 0; a < scale; a++)
            for (let b = 0; b < scale; b++)
              put(px0 + 2 * scale + (k * 4 + q) * scale + b, py0 + 2 * scale + rr * scale + a, WHITE)
  })
}

/** A pixel heart of radius ~r centred at (cx, cy), shaded light → dark from the top. */
const drawHeart = (put: (x: number, y: number, c: number) => void, cx: number, cy: number, r: number, outline: boolean) => {
  const inside = (x: number, y: number) => {
    const u = x / r
    const v = -y / r
    return (u * u + v * v - 1) ** 3 - u * u * v * v * v <= 0
  }
  for (let y = Math.floor(-1.35 * r); y <= Math.ceil(1.1 * r); y++)
    for (let x = Math.floor(-1.3 * r); x <= Math.ceil(1.3 * r); x++) {
      if (!inside(x, y)) continue
      const edge = outline && (!inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1))
      put(cx + x, cy + y, edge ? INK : y < -r / 2 ? S.heart[0] : y < r / 3 ? S.heart[1] : S.heart[2])
    }
}

/**
 * The stadium stage with these members dancing on it. With nobody working it is
 * shown empty: the same stage with its lights low, no fountains. `phase` drives lights, sparkles, hops and notes.
 */
export const stagePng = (dancers: readonly Dancer[], phase: number): string => {
  const key = `${phase % 24}|${dancers.map(d => `${d.id}:${d.name}`).join(',')}`
  const hit = stageCache.get(key)
  if (hit) return hit
  const W = STAGE_W
  const H = STAGE_H
  const live = dancers.length > 0
  const px = new Uint8Array(W * H)
  const put = (x: number, y: number, c: number) => {
    x = Math.round(x)
    y = Math.round(y)
    if (c > 0 && x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = c
  }

  // Sky after the user's reference fondo1: violet night, star dust, big lilac pixel
  // clouds and cream sparkles that twinkle (no searchlights, no balloon).
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) put(x, y, y < 3 || (y === 3 && x % 2 === 0) ? SKY_HI : SKY)
  const dust = rand(1306)
  for (let i = 0; i < 70; i++) put(dust() * W, dust() * 60, dust() < 0.75 ? WHITE : CREAM)
  for (const [cx, cy, k] of [[34, 14, 0.85], [122, 9, 0.75], [204, 16, 0.9], [78, 30, 0.6], [170, 32, 0.6]] as const)
    drawCloud(put, cx, cy, k, 40)
  const r = rand(777)
  for (let i = 0; i < 22; i++) {
    const x = r() * W
    const y = r() * 40
    const on = (phase + i) % 4
    if (on === 0) continue
    put(x, y, on === 3 ? CREAM : WHITE)
    if (on === 3) {
      const arm = i % 2 === 0 ? 2 : 1
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
        for (let d = 1; d <= arm; d++) put(x + dx * d, y + dy * d, d < arm ? CREAM : WHITE)
    }
  }

  // Stands on both sides: dark slopes full of lightsticks that blink in waves.
  for (let y = 30; y < H; y++)
    for (let x = 0; x < W; x++) {
      const left = x < 38 && y > 30 + x * 0.5
      const right = x >= W - 38 && y > 30 + (W - 1 - x) * 0.5
      if (!left && !right) continue
      put(x, y, S.crowd)
      if (x % 3 === 1 && y % 3 === 1) {
        const wave = (Math.floor(x / 6) + Math.floor(y / 6) + phase) % 3
        put(x, y, live ? (wave === 0 ? WHITE : wave === 1 ? LILAC : S.rim) : S.rim)
      }
    }

  // The stage: a ring truss of round bulbs over four LED screens and a heart.
  const ringY = (x: number) => 26 + Math.round(((x - W / 2) / 80) ** 2 * 5)
  for (let x = 40; x < W - 40; x++) {
    const y0 = ringY(x)
    for (let y = y0; y < y0 + 6; y++) put(x, y, y === y0 || y === y0 + 5 || (x + y) % 6 === 0 ? S.trussHi : S.truss)
  }
  for (let i = 0, x = 46; x < W - 44; i++, x += 12) {
    const y0 = ringY(x) + 3
    const on = !live || (i + phase) % 3 !== 0
    const c = live ? (on ? S.bulb : S.cyan) : S.mesh
    for (let y = -2; y <= 2; y++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + y * y <= 4) put(x + dx, y0 + y, c)
    if (live && on) for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]] as const) put(x + dx, y0 + dy, S.cyan)
  }

  // Screens: our chibis on the big LEDs behind a mesh (BORAHAE when nobody plays).
  const screens = [[44, 36, 34, 30], [80, 38, 26, 28], [134, 38, 26, 28], [162, 36, 34, 30]] as const
  screens.forEach(([sx, sy, sw, sh], i) => {
    for (let y = sy; y < sy + sh; y++)
      for (let x = sx; x < sx + sw; x++) {
        const edge = x === sx || x === sx + sw - 1 || y === sy || y === sy + sh - 1
        put(x, y, edge ? S.bulb : S.screen)
      }
    const d = live ? dancers[i % dancers.length] : undefined
    const sp = d ? dancerSprites[d.id] : undefined
    if (sp) {
      const frame = sp.px[(phase + i) % 2 === 1 ? 1 : 0]
      const ox = sx + Math.floor((sw - 32) / 2)
      const oy = sy + 2 - sp.top
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const X = ox + x
          const Y = oy + y
          if (X <= sx || X >= sx + sw - 1 || Y <= sy || Y >= sy + sh - 1) continue
          const c = frame[y * 32 + x]!
          if (c) put(X, Y, (X + Y) % 3 === 0 ? S.mesh : c)
        }
    } else {
      for (let y = sy + 1; y < sy + sh - 1; y++)
        for (let x = sx + 1; x < sx + sw - 1; x++) if ((x + y) % 3 === 0) put(x, y, S.mesh)
    }
  })
  // The heart in the middle, tall like a monument, on a small staircase.
  drawHeart(put, W / 2, 48, 10, true)
  for (let s = 0; s < 4; s++) for (let x = W / 2 - 8 + s * 2; x <= W / 2 + 8 - s * 2; x++) put(x, 66 + s, s % 2 ? S.rim : LILAC)

  // Sparkle fountains on both sides of the stage.
  if (live) {
    for (const fx of [40, W - 41]) {
      for (let k = 0; k < 18; k++) {
        const t = (k * 7 + phase * 3) % 30
        const y = DECK_Y - t
        const x = fx + Math.round(Math.sin(k * 1.7 + t / 4) * (t / 8))
        put(x, y, t < 10 ? S.spark : t < 20 ? S.bulb : S.cyan)
      }
    }
  }

  // Deck: a glowing front edge, then the crowd's front rows below it.
  for (let y = DECK_Y; y < DECK_Y + 6; y++)
    for (let x = 38; x < W - 38; x++) put(x, y, y === DECK_Y ? S.cyan : y === DECK_Y + 5 ? S.rim : S.deck)
  for (let y = DECK_Y + 6; y < H; y++)
    for (let x = 0; x < W; x++) {
      put(x, y, S.crowd)
      if (x % 4 === 2 && (y - DECK_Y) % 4 === 0) {
        const wave = (Math.floor(x / 8) + phase) % 4
        put(x, y, live ? (wave < 2 ? WHITE : wave === 2 ? LILAC : S.heart[0]) : S.rim)
        if (live && wave < 2) put(x, y - 1, S.rim)
      }
    }

  // Dancers on the deck: swaying, hopping, a plate over the head and a rising note.
  const n = dancers.length
  const margin = n >= 5 ? 38 : 50
  const inner = W - 2 * margin
  const SWAY = [0, 1, 2, 1, 0, -1, -2, -1]
  dancers.forEach((d, i) => {
    const sp = dancerSprites[d.id]
    if (!sp) return
    const beat = phase + i * 3
    const cx = Math.round(margin + (inner * (i + 0.5)) / n + (SWAY[beat % SWAY.length] ?? 0))
    const hop = beat % 4 === 1 ? 2 : 0
    const oy = DECK_Y + 4 - sp.bottom - hop
    const frame = sp.px[beat % 2 === 1 ? 1 : 0]
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) put(cx - 16 + x, oy + y, frame[y * 32 + x]!)
    const crowded = n >= 5
    const py0 = Math.max(1, oy + sp.top - 11 - (crowded && i % 2 === 1 ? 10 : 0))
    drawPlate(put, W, cx, py0, d.name, PLATE.rest)
    const rise = beat % 4
    const nx = (i % 2 === 0 ? cx + 11 : cx - 15) + (rise % 2)
    const ny = oy + sp.top + 4 - rise * 3
    const nc = S.confetti[beat % 5]!
    NOTE_GLYPH.forEach((row, rr) => Array.from(row).forEach((ch, q) => ch === '1' && put(nx + q, ny + rr, nc)))
  })

  const png = encodePng(px, W, H)
  if (stageCache.size > 80) stageCache.clear()
  stageCache.set(key, png)
  return png
}
