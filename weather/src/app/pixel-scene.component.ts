import { Component, ElementRef, NgZone, OnDestroy, afterNextRender, effect, inject, input, viewChild } from '@angular/core';
import { Sky } from './weather.service';

interface Palette {
  sky: string[];       // top → horizon bands
  far: string;         // distant mountains
  farSnow: string;
  hills: string;
  ground: string;
  grass: string;
  tree: string;
  treeDark: string;
  cloud: string;
  cloudShade: string;
  window: string;
}

interface Cloud { x: number; y: number; size: number; speed: number; }
interface Drop { x: number; y: number; speed: number; drift: number; }

/** Internal resolution height; width follows the viewport's aspect ratio. */
const H = 120;

/**
 * Animated pixel-art landscape drawn at a tiny resolution on a canvas and
 * scaled up with `image-rendering: pixelated`. Reacts to the weather and day/night.
 */
@Component({
  selector: 'app-pixel-scene',
  template: `<canvas #canvas aria-hidden="true"></canvas>`,
  styles: `
    :host { position: fixed; inset: 0; z-index: -1; background: #1b2558; }
    canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
  `,
})
export class PixelSceneComponent implements OnDestroy {
  sky = input<Sky>('clear');
  isDay = input(true);

  private zone = inject(NgZone);
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private ctx?: CanvasRenderingContext2D;
  private terrain?: HTMLCanvasElement;
  private w = 200;
  /** Canvas height; taller than H on portrait screens, with the extra space added as sky. */
  private h = H;
  private frame = 0;
  private raf = 0;
  private clouds: Cloud[] = [];
  private drops: Drop[] = [];
  private chimneys: { x: number; y: number }[] = [];
  private flash = 0;
  private reducedMotion = false;
  private onResize = () => this.rebuild();

  constructor() {
    afterNextRender(() => {
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.ctx = this.canvas().nativeElement.getContext('2d')!;
      window.addEventListener('resize', this.onResize);
      this.setup();
      const loop = () => {
        this.draw();
        if (!this.reducedMotion) this.raf = requestAnimationFrame(loop);
      };
      // Animate outside Angular so each frame doesn't trigger change detection.
      this.zone.runOutsideAngular(loop);
    });

    // Rebuild the scene whenever the weather changes.
    effect(() => {
      this.sky();
      this.isDay();
      if (this.ctx) this.rebuild();
    });
  }

  /**
   * Resizing a canvas wipes it, so with reduced motion (no animation loop)
   * the scene has to be redrawn by hand.
   */
  private rebuild() {
    this.setup();
    if (this.reducedMotion) this.draw();
  }

  ngOnDestroy() {
    // Nothing to clean up when the component was rendered on the server.
    if (typeof window === 'undefined') return;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
  }

  private get palette(): Palette {
    const sky = this.sky();
    const gloomy = sky === 'cloudy' || sky === 'rain' || sky === 'storm' || sky === 'fog';
    const snowy = sky === 'snow';

    if (!this.isDay()) {
      return {
        sky: sky === 'storm'
          ? ['#07080f', '#0c0f1c', '#121729', '#181f36', '#1f2843']
          : gloomy || snowy
            ? ['#0e1224', '#141a33', '#1b2240', '#222b4e', '#2a355c']
            : ['#0b1030', '#111845', '#18215a', '#212c6c', '#2c387d'],
        far: '#1d2547', farSnow: '#3a4672',
        hills: snowy ? '#5a6788' : '#14303a',
        ground: snowy ? '#7886a6' : '#0f252c',
        grass: snowy ? '#8e9cbb' : '#1a3d40',
        tree: '#0d2a26', treeDark: '#081c1a',
        cloud: '#3b4466', cloudShade: '#2a3150',
        window: '#ffd45e',
      };
    }
    if (snowy) {
      return {
        sky: ['#8ea4c2', '#9db2cd', '#adbfd7', '#bdcde1', '#cddaea'],
        far: '#8f9fbb', farSnow: '#eef3fa',
        hills: '#dfe7f2', ground: '#eef3f9', grass: '#ffffff',
        tree: '#2c5a4a', treeDark: '#1e4236',
        cloud: '#eef2f8', cloudShade: '#c8d2e0',
        window: '#f6c453',
      };
    }
    if (gloomy) {
      const storm = sky === 'storm';
      return {
        sky: storm
          ? ['#2e3440', '#363d4b', '#3f4756', '#495162', '#545d6e']
          : sky === 'fog'
            ? ['#8a929c', '#959ca6', '#a1a8b1', '#adb3bb', '#b9bec5']
            : ['#5b6778', '#667283', '#727e8f', '#7f8a9b', '#8c97a7'],
        far: storm ? '#3b4250' : '#6c7686', farSnow: storm ? '#5a6272' : '#9aa3b0',
        hills: '#3f6e48', ground: '#2f5a37', grass: '#4c8a50',
        tree: '#24482c', treeDark: '#183520',
        cloud: storm ? '#4a5160' : '#a7afba', cloudShade: storm ? '#353b47' : '#8790a0',
        window: '#f6c453',
      };
    }
    return {
      sky: ['#3b7dd8', '#4a8de2', '#5c9eea', '#74b2f1', '#94c8f6'],
      far: '#6f86b5', farSnow: '#dfe8f7',
      hills: '#43a253', ground: '#2f7d3c', grass: '#62c65e',
      tree: '#1f6233', treeDark: '#154a26',
      cloud: '#ffffff', cloudShade: '#d3e3f5',
      window: '#f6c453',
    };
  }

  /** Resize the canvas and regenerate terrain, clouds and particles. */
  private setup() {
    const el = this.canvas().nativeElement;
    const aspect = window.innerHeight > 0 && window.innerWidth > 0
      ? window.innerWidth / window.innerHeight
      : 16 / 9;
    // Keep pixels square: on narrow (portrait) screens the canvas grows taller
    // instead of being stretched, and the extra rows become sky.
    this.w = Math.min(480, Math.max(160, Math.round(H * aspect)));
    this.h = Math.max(H, Math.round(this.w / aspect));
    el.width = this.w;
    el.height = this.h;
    this.ctx!.imageSmoothingEnabled = false;
    this.terrain = this.buildTerrain();

    const sky = this.sky();
    const cloudCount = { clear: 1, partly: 4, cloudy: 8, fog: 5, rain: 9, snow: 7, storm: 10 }[sky];
    this.clouds = Array.from({ length: cloudCount }, (_, i) => ({
      x: (i / cloudCount) * (this.w + 40) - 20 + rand(i, 1) * 20,
      y: 6 + rand(i, 2) * (sky === 'clear' || sky === 'partly' ? 30 : 22),
      size: 4 + rand(i, 3) * 5,
      speed: 0.04 + rand(i, 4) * 0.06,
    }));

    const dropCount = sky === 'rain' ? 140 : sky === 'storm' ? 220 : sky === 'snow' ? 120 : 0;
    this.drops = Array.from({ length: dropCount }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      speed: sky === 'snow' ? 0.25 + Math.random() * 0.3 : 1.8 + Math.random() * 1.2,
      drift: Math.random() * Math.PI * 2,
    }));
  }

  /** Static landscape and village, drawn once to an offscreen canvas. */
  private buildTerrain(): HTMLCanvasElement {
    const p = this.palette;
    const snowy = this.sky() === 'snow';
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = H;
    const g = c.getContext('2d')!;
    const W = this.w;
    const px = (x: number, y: number, w: number, h: number, color: string) => {
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
    };

    // Hazy far-away range, half faded into the sky.
    const haze = mix(p.far, p.sky[p.sky.length - 1], 0.55);
    for (let x = 0; x < W; x++) {
      const top = Math.round(57 - 9 * Math.abs(Math.sin(x * 0.028 + 4)) - 4 * Math.sin(x * 0.13 + 1));
      px(x, top, 1, H - top, haze);
    }

    // Main mountains: lit left-facing slopes, shaded right-facing ones, ragged snow caps.
    const mRaw = (x: number) => 62 - 16 * Math.abs(Math.sin(x * 0.045 + 1)) - 7 * Math.sin(x * 0.11 + 3);
    const mTop = (x: number) => Math.round(mRaw(x));
    const farShade = mix(p.far, '#000000', 0.2);
    const farLight = mix(p.far, '#ffffff', 0.18);
    const snowShade = mix(p.farSnow, p.far, 0.35);
    for (let x = 0; x < W; x++) {
      const top = mTop(x);
      // Use the unrounded slope, otherwise gentle slopes flicker between lit and shaded columns.
      const shaded = mRaw(x + 1) > mRaw(x);
      px(x, top, 1, H - top, shaded ? farShade : p.far);
      if (!shaded) px(x, top, 1, 1, farLight);
      const snowLine = 50 + (x % 3 === 0 ? 1 : 0) - (x % 5 === 0 ? 1 : 0);
      if (top < snowLine) px(x, top, 1, snowLine - top, shaded ? snowShade : p.farSnow);
    }

    // Back hills with tiny far-off trees.
    const backTop = (x: number) => Math.round(75 - 5 * Math.sin(x * 0.05 + 1.5) - 2 * Math.sin(x * 0.13));
    const hillsBack = mix(p.hills, p.far, 0.45);
    for (let x = 0; x < W; x++) px(x, backTop(x), 1, H - backTop(x), hillsBack);
    const tinyTree = mix(p.treeDark, p.far, 0.35);
    for (let i = 0; i < W / 7; i++) {
      const x = Math.round(rand(i, 61) * W);
      const y = backTop(x);
      px(x, y - 3, 1, 3, tinyTree);
      px(x - 1, y - 1, 3, 1, tinyTree);
    }

    // Front hills: highlighted edge and a sprinkle of darker texture.
    const hillTop = (x: number) => Math.round(80 - 6 * Math.sin(x * 0.035) - 3 * Math.sin(x * 0.09 + 2));
    const hillsShade = mix(p.hills, '#000000', 0.14);
    const hillsLight = mix(p.hills, '#ffffff', snowy ? 0.5 : 0.16);
    for (let x = 0; x < W; x++) {
      const top = hillTop(x);
      px(x, top, 1, H - top, p.hills);
      px(x, top, 1, 1, hillsLight);
      for (let y = top + 3; y < 97; y += 2) {
        if ((x + y) % 4 === 0 && rand(x, y) > 0.45) px(x, y, 1, 1, hillsShade);
      }
    }
    for (let i = 0; i < W / 11; i++) {
      const x = Math.round(rand(i, 7) * W);
      const base = hillTop(x) + 2;
      if (rand(i, 9) < 0.65) this.pine(g, x, base, 4 + Math.floor(rand(i, 8) * 4), p);
      else this.roundTree(g, x, base, 2 + Math.floor(rand(i, 8) * 2), p);
    }

    // Foreground meadow.
    const groundTop = (x: number) => Math.round(96 - 2 * Math.sin(x * 0.05 + 1));
    const groundDark = mix(p.ground, '#000000', 0.2);
    for (let x = 0; x < W; x++) {
      const top = groundTop(x);
      px(x, top, 1, H - top, p.ground);
      const tuft = rand(x, 21) > 0.72 ? 2 : 0;
      px(x, top - tuft, 1, tuft + (x % 3 === 0 ? 2 : 1), p.grass);
      for (let y = top + 3; y < H; y++) {
        if (rand(x * 7 + y, 22) > 0.92) px(x, y, 1, 1, groundDark);
      }
      px(x, H - 3, 1, 3, groundDark);
    }

    // A winding dirt path with pebbles.
    const pathY = (x: number) => Math.round(108 + 2 * Math.sin(x * 0.04));
    const path = snowy ? '#cfd8e4' : this.tint('#b89a68');
    const pathEdge = mix(path, '#000000', 0.22);
    for (let x = 0; x < W; x++) {
      const y = pathY(x);
      px(x, y, 1, 3, path);
      px(x, y + 3, 1, 1, pathEdge);
      if (rand(x, 31) > 0.86) px(x, y + 1, 1, 1, pathEdge);
    }

    // Wildflowers (not under snow).
    if (!snowy) {
      const flowers = ['#ff6b8b', '#ffd23f', '#ffffff', '#b48cff'].map((f) => this.tint(f));
      for (let i = 0; i < W / 4; i++) {
        const x = Math.round(rand(i, 71) * W);
        const top = groundTop(x);
        const y = top + 3 + Math.floor(rand(i, 72) * (H - top - 7));
        if (Math.abs(y - pathY(x) - 1) < 3) continue;
        px(x, y + 1, 1, 1, p.grass);
        px(x, y, 1, 1, flowers[i % flowers.length]);
      }
    }

    // The village: houses spread along the meadow, with trees, fences and lamps between them.
    this.chimneys = [];
    const count = Math.max(3, Math.round(W / 40));
    const slot = W / count;
    for (let i = 0; i < count; i++) {
      const w = 12 + Math.floor(rand(i, 41) * 3) * 2;
      const x = Math.round(slot * i + (slot - w) / 2 + (rand(i, 42) - 0.5) * slot * 0.3);
      const base = groundTop(x + w / 2) + 1;
      const doorX = this.house(g, x, base, w, i, p);
      // Little path from the front door down to the main path.
      for (let y = base; y < pathY(doorX + 1); y++) px(doorX, y, 3, 1, path);

      // Something between this house and the next one.
      const gapX = Math.round(slot * (i + 1) + (rand(i, 43) - 0.5) * 6) - 3;
      if (gapX > W - 2) continue;
      const kind = rand(i, 44);
      if (kind < 0.4) this.pine(g, gapX, groundTop(gapX) + 1, 8 + Math.floor(rand(i, 45) * 4), p);
      else if (kind < 0.7) this.roundTree(g, gapX, groundTop(gapX) + 1, 4 + Math.floor(rand(i, 45) * 2), p);
      else this.lamp(g, gapX, groundTop(gapX) + 1);
      if (rand(i, 46) > 0.4) this.fence(g, x + w + 2, groundTop(x + w + 2) + 1, Math.min(8, gapX - x - w - 5));
    }
    return c;
  }

  /** Colours shift darker and bluer at night, and greyer under heavy cloud. */
  private tint(color: string) {
    if (!this.isDay()) return mix(color, '#141a3a', 0.55);
    const sky = this.sky();
    if (sky === 'storm') return mix(color, '#3a4050', 0.35);
    if (sky === 'cloudy' || sky === 'rain' || sky === 'fog') return mix(color, '#7f8a9b', 0.2);
    return color;
  }

  private pine(g: CanvasRenderingContext2D, x: number, base: number, height: number, p: Palette) {
    g.fillStyle = this.tint('#5a3a22');
    g.fillRect(x, base - 2, 1, 2);
    for (let row = 0; row < height; row++) {
      const half = Math.floor((height - row) / 2.2) + (row % 3 === 0 ? 1 : 0);
      g.fillStyle = row % 3 === 0 ? p.treeDark : p.tree;
      g.fillRect(x - half, base - 2 - row, half * 2 + 1, 1);
      // Shaded right side.
      g.fillStyle = p.treeDark;
      g.fillRect(x + 1, base - 2 - row, half, 1);
    }
    if (this.sky() === 'snow') {
      g.fillStyle = '#ffffff';
      g.fillRect(x, base - 2 - height, 1, 1);
      g.fillRect(x - 1, base - 1 - height, 2, 1);
      for (let row = 2; row < height; row += 3) {
        const half = Math.floor((height - row) / 2.2) + 1;
        g.fillRect(x - half, base - 2 - row, half, 1);
      }
    }
  }

  private roundTree(g: CanvasRenderingContext2D, x: number, base: number, r: number, p: Palette) {
    g.fillStyle = this.tint('#5a3a22');
    g.fillRect(x, base - r - 1, 1, r + 1);
    const cy = base - r - 2;
    disc(g, x, cy, r, p.treeDark);
    disc(g, x - 1, cy - 1, r - 1, p.tree);
    disc(g, x - Math.ceil(r / 2), cy - Math.ceil(r / 2), Math.max(1, r - 3), mix(p.tree, '#ffffff', 0.18));
    if (this.sky() === 'snow') {
      g.fillStyle = '#ffffff';
      g.fillRect(x - r + 1, cy - r, r * 2 - 1, 1);
      g.fillRect(x - r, cy - r + 1, r, 1);
    }
  }

  private fence(g: CanvasRenderingContext2D, x: number, ground: number, length: number) {
    if (length < 4) return;
    g.fillStyle = this.tint('#9a7650');
    for (let i = 0; i <= length; i += 3) g.fillRect(x + i, ground - 4, 1, 4);
    g.fillRect(x, ground - 3, length + 1, 1);
    g.fillStyle = this.tint('#6e5034');
    g.fillRect(x, ground - 1, length + 1, 1);
  }

  private lamp(g: CanvasRenderingContext2D, x: number, ground: number) {
    const night = !this.isDay();
    g.fillStyle = '#2b2f3a';
    g.fillRect(x, ground - 9, 1, 9);
    g.fillRect(x - 1, ground - 10, 3, 1);
    g.fillStyle = night ? '#ffe98a' : '#d8dde6';
    g.fillRect(x, ground - 11, 1, 1);
    if (night) {
      // Soft dithered glow around the bulb.
      g.fillStyle = 'rgba(255, 220, 120, 0.35)';
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if ((dx + dy) % 2 === 0 && dx * dx + dy * dy <= 10 && (dx || dy)) g.fillRect(x + dx, ground - 11 + dy, 1, 1);
        }
      }
    }
  }

  /** Draws house number `i` (its look is picked from i) and returns the x of its door. */
  private house(g: CanvasRenderingContext2D, x: number, base: number, w: number, i: number, p: Palette): number {
    const px = (x0: number, y0: number, w0: number, h0: number, color: string) => {
      g.fillStyle = color;
      g.fillRect(x0, y0, w0, h0);
    };
    const pick = <T>(list: T[], seed: number) => list[Math.floor(rand(i, seed) * list.length)];
    const night = !this.isDay();
    const snowy = this.sky() === 'snow';

    const style = pick(['wood', 'plaster', 'stone', 'brick'] as const, 51);
    const wallBase = { wood: '#c98b5a', plaster: '#ece0c4', stone: '#a7a9b0', brick: '#b5654a' }[style];
    const wall = this.tint(wallBase);
    const wallShade = mix(wall, '#000000', 0.18);
    const roof = this.tint(pick(['#b23b3b', '#3f5f9a', '#6b4a2f', '#3f7a4a', '#8a3b6b'], 52));
    const roofShade = mix(roof, '#000000', 0.2);
    const trim = this.tint('#5a3a22');
    const wallH = 8 + Math.floor(rand(i, 53) * 3);
    const top = base - wallH;

    // Walls, with the right side in shade.
    px(x, top, w, wallH, wall);
    px(x + w - 2, top, 2, wallH, wallShade);
    if (style === 'wood') {
      for (let y = top + 2; y < base; y += 2) px(x, y, w - 2, 1, mix(wall, '#000000', 0.1));
    } else if (style === 'plaster') {
      // Timber framing.
      px(x, top, 1, wallH, trim);
      px(x + w - 1, top, 1, wallH, trim);
      px(x, top + Math.floor(wallH / 2), w, 1, trim);
    } else {
      // Stone or brick blocks.
      const mortar = mix(wall, '#000000', 0.22);
      for (let y = top + 1; y < base; y += 2) {
        for (let bx = x + ((y - top) % 4 === 1 ? 0 : 2); bx < x + w - 2; bx += 4) px(bx, y, 1, 1, mortar);
      }
    }
    px(x, base - 1, w, 1, mix(wall, '#000000', 0.3));   // foundation line

    // Stepped roof with a dark eave and a shaded right half.
    const rows = Math.ceil(w / 2) + 1;
    for (let r = 0; r < rows; r++) {
      const rx = x - 2 + r;
      const rw = w + 4 - r * 2;
      if (rw <= 0) break;
      const y = top - 1 - r;
      if (r === 0) {
        px(rx, y, rw, 1, roofShade);
        continue;
      }
      px(rx, y, Math.ceil(rw / 2), 1, roof);
      px(rx + Math.ceil(rw / 2), y, Math.floor(rw / 2), 1, roofShade);
      if (r % 2 === 0) {
        for (let tx = rx + 1; tx < rx + rw - 1; tx += 3) px(tx, y, 1, 1, mix(roof, '#000000', 0.12));
      }
      if (snowy && r >= 2) {
        px(rx, y, Math.ceil(rw / 2), 1, '#ffffff');
        px(rx + Math.ceil(rw / 2), y, Math.floor(rw / 2), 1, '#d6e0ee');
      }
    }

    // Chimney (most houses), sitting on the roof slope.
    if (rand(i, 55) > 0.2) {
      const cx = x + (rand(i, 56) > 0.5 ? w - 4 : 2);
      const rmax = Math.min(cx - x + 2, x + w + 1 - cx, rows - 1);
      const roofY = top - 1 - rmax;
      px(cx, roofY - 3, 2, 4, this.tint('#7a5236'));
      px(cx - 1, roofY - 4, 4, 1, this.tint('#5a3c26'));
      if (snowy) px(cx - 1, roofY - 5, 4, 1, '#ffffff');
      this.chimneys.push({ x: cx + 1, y: roofY - 5 - (snowy ? 1 : 0) });
    }

    // Door with frame and knob.
    const doorX = x + 2 + Math.floor(rand(i, 57) * 2);
    px(doorX - 1, base - 6, 5, 1, trim);
    px(doorX, base - 5, 3, 5, this.tint(pick(['#5a3a22', '#2f4a6b', '#6b2f2f', '#3f5a2f'], 58)));
    px(doorX + 2, base - 3, 1, 1, '#e8c860');

    // Windows: lit at night for most houses, sky-blue glass by day.
    const lit = night && rand(i, 59) > 0.25;
    const glass = night ? (lit ? p.window : '#262b48') : this.tint('#a8d8f0');
    for (let wx = doorX + 5; wx + 3 <= x + w - 2; wx += 6) {
      const wy = top + 2;
      px(wx - 1, wy - 1, 5, 5, trim);
      px(wx, wy, 3, 3, glass);
      px(wx + 1, wy, 1, 3, trim);                         // mullion
      if (!night) px(wx, wy, 1, 1, '#e4f4ff');            // glint
      px(wx - 1, wy + 3, 5, 1, mix(wall, '#ffffff', 0.25)); // sill
      if (lit) {
        g.fillStyle = 'rgba(255, 210, 110, 0.25)';
        g.fillRect(wx - 2, wy - 2, 7, 7);
      }
    }
    return doorX;
  }

  private draw() {
    const g = this.ctx!;
    const p = this.palette;
    const sky = this.sky();
    const t = this.frame++;
    // Extra sky rows on portrait screens: the landscape sits at the bottom,
    // and the sun and clouds move down part of the way so they stay in view.
    const extra = this.h - H;
    const lift = Math.round(extra * 0.6);

    // Sky in hard bands with a dithered edge between each one.
    const skyHeight = 70 + extra;
    const band = Math.ceil(skyHeight / p.sky.length);
    for (let i = 0; i < p.sky.length; i++) {
      g.fillStyle = p.sky[i];
      g.fillRect(0, i * band, this.w, band);
      if (i > 0) {
        g.fillStyle = p.sky[i - 1];
        for (let x = (i % 2); x < this.w; x += 2) g.fillRect(x, i * band, 1, 1);
      }
    }
    g.fillStyle = p.sky[p.sky.length - 1];
    g.fillRect(0, skyHeight, this.w, this.h - skyHeight);

    // Stars at night when the sky is clear enough.
    if (!this.isDay() && (sky === 'clear' || sky === 'partly')) {
      const count = Math.round(60 * (55 + extra) / 55);
      for (let i = 0; i < count; i++) {
        const twinkle = (t / 30 + i * 1.7) % 6 < 1;
        g.fillStyle = twinkle ? '#7f8bd0' : '#f2f4ff';
        g.fillRect(Math.floor(rand(i, 11) * this.w), Math.floor(rand(i, 12) * (55 + extra)), 1, 1);
      }
    }

    // Sun or moon.
    if (sky === 'clear' || sky === 'partly') {
      const cx = Math.round(this.w * 0.22);
      if (this.isDay()) {
        const cy = 22 + lift;
        disc(g, cx, cy, 9, '#ffe9a0');
        disc(g, cx, cy, 7, '#ffd23f');
        if (Math.floor(t / 40) % 2 === 0) {            // blinking rays
          g.fillStyle = '#ffe9a0';
          for (const [dx, dy] of [[0, -13], [0, 12], [-13, 0], [12, 0], [-9, -9], [8, -9], [-9, 8], [8, 8]]) {
            g.fillRect(cx + dx, cy + dy, 2, 2);
          }
        }
      } else {
        disc(g, cx, 20 + lift, 7, '#f4f1d6');
        disc(g, cx + 3, 18 + lift, 6, p.sky[1]);      // crescent cut-out
      }
    }

    g.drawImage(this.terrain!, 0, extra);

    // Chimney smoke: puffs rise, drift with the wind and fade out.
    const smoke = this.isDay() ? '230, 233, 238' : '128, 136, 168';
    this.chimneys.forEach((ch, n) => {
      for (let k = 0; k < 5; k++) {
        const phase = (t * 0.012 + k / 5 + n * 0.37) % 1;
        const size = phase < 0.35 ? 1 : 2;
        g.fillStyle = `rgba(${smoke}, ${(0.75 * (1 - phase)).toFixed(2)})`;
        g.fillRect(
          Math.round(ch.x + phase * 6 + Math.sin(phase * 7 + n) * 1.2),
          Math.round(ch.y + extra - phase * 16),
          size, size,
        );
      }
    });

    // Birds on fine days.
    if (this.isDay() && (sky === 'clear' || sky === 'partly')) {
      g.fillStyle = '#2a2f45';
      for (let i = 0; i < 3; i++) {
        const bx = Math.round(((t * 0.12 + i * 37) % (this.w + 30)) - 15);
        const by = Math.round(18 + lift + i * 5 + Math.sin(t / 25 + i) * 2);
        const up = Math.floor(t / 10 + i) % 2 === 0;
        g.fillRect(bx, by, 1, 1);
        g.fillRect(bx - 1, by + (up ? -1 : 0), 1, 1);
        g.fillRect(bx + 1, by + (up ? -1 : 0), 1, 1);
        g.fillRect(bx - 2, by + (up ? -1 : 1), 1, 1);
        g.fillRect(bx + 2, by + (up ? -1 : 1), 1, 1);
      }
    }

    // Fireflies on dry nights.
    if (!this.isDay() && (sky === 'clear' || sky === 'partly' || sky === 'cloudy')) {
      for (let i = 0; i < 10; i++) {
        if ((t / 20 + i * 2.3) % 4 > 2.2) continue;
        const fx = Math.round(rand(i, 81) * this.w + Math.sin(t / 60 + i) * 4);
        const fy = Math.round(84 + rand(i, 82) * 22 + extra + Math.cos(t / 45 + i) * 3);
        g.fillStyle = '#e8ff7a';
        g.fillRect(fx, fy, 1, 1);
      }
    }

    // Clouds drift slowly and wrap around.
    for (const c of this.clouds) {
      c.x += c.speed;
      if (c.x - c.size * 3 > this.w) c.x = -c.size * 3;
      this.cloud(g, Math.round(c.x), Math.round(c.y) + lift, c.size, p);
    }

    // Fog banks.
    if (sky === 'fog') {
      g.fillStyle = 'rgba(220, 224, 230, 0.45)';
      for (let i = 0; i < 4; i++) {
        const y = 60 + extra + i * 12;
        const off = Math.round(Math.sin(t / 120 + i) * 10);
        for (let x = -20; x < this.w + 20; x += 40) g.fillRect(x + off + i * 7, y, 30, 4);
      }
    }

    // Rain and snow.
    for (const d of this.drops) {
      d.y += d.speed;
      if (sky === 'snow') {
        d.x += Math.sin(t / 25 + d.drift) * 0.2;
        g.fillStyle = '#ffffff';
        g.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
      } else {
        d.x -= d.speed * 0.25;
        g.fillStyle = this.isDay() ? '#c7dcf2' : '#6f86c4';
        g.fillRect(Math.round(d.x), Math.round(d.y), 1, 3);
      }
      if (d.y > this.h) { d.y = -3; d.x = Math.random() * (this.w + 20); }
      if (d.x < -2) d.x = this.w;
    }

    // Lightning.
    if (sky === 'storm') {
      if (this.flash === 0 && Math.random() < 0.004) this.flash = 12;
      if (this.flash > 0) {
        this.flash--;
        if (this.flash > 8) {
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.fillRect(0, 0, this.w, this.h);
          this.bolt(g, Math.round(this.w * 0.55), 12 + lift);
        }
      }
    }
  }

  private cloud(g: CanvasRenderingContext2D, x: number, y: number, s: number, p: Palette) {
    const puffs: [number, number, number][] = [[0, 0, s], [s * 1.2, -s * 0.5, s * 1.2], [s * 2.4, 0, s * 0.9]];
    for (const [dx, dy, r] of puffs) disc(g, x + Math.round(dx), y + Math.round(dy) + 1, Math.round(r), p.cloudShade);
    for (const [dx, dy, r] of puffs) disc(g, x + Math.round(dx), y + Math.round(dy), Math.round(r), p.cloud);
  }

  private bolt(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = '#fff6a8';
    for (let i = 0; i < 40; i++) {
      g.fillRect(x, y + i, 1, 1);
      if (i % 6 === 5) x += i % 12 === 5 ? 2 : -2;
    }
  }
}

/** Blends two #rrggbb colours; t = 0 gives a, t = 1 gives b. */
function mix(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16), cb = parseInt(b.slice(1), 16);
  let out = '#';
  for (const shift of [16, 8, 0]) {
    const va = (ca >> shift) & 255, vb = (cb >> shift) & 255;
    out += Math.round(va + (vb - va) * t).toString(16).padStart(2, '0');
  }
  return out;
}

/** Filled pixel circle. */
function disc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  g.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

/** Deterministic pseudo-random number in [0, 1) so the scenery doesn't jump on resize. */
function rand(i: number, seed: number) {
  const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
