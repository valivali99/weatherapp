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
  private frame = 0;
  private raf = 0;
  private clouds: Cloud[] = [];
  private drops: Drop[] = [];
  private flash = 0;
  private reducedMotion = false;
  private onResize = () => this.setup();

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
      if (this.ctx) {
        this.setup();
        if (this.reducedMotion) this.draw();
      }
    });
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
    const aspect = window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 9;
    this.w = Math.min(480, Math.max(120, Math.round(H * aspect)));
    el.width = this.w;
    el.height = H;
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
      y: Math.random() * H,
      speed: sky === 'snow' ? 0.25 + Math.random() * 0.3 : 1.8 + Math.random() * 1.2,
      drift: Math.random() * Math.PI * 2,
    }));
  }

  /** Static mountains, hills, trees and a little house, drawn once to an offscreen canvas. */
  private buildTerrain(): HTMLCanvasElement {
    const p = this.palette;
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = H;
    const g = c.getContext('2d')!;

    // Distant mountains with snowy peaks.
    for (let x = 0; x < this.w; x++) {
      const top = Math.round(62 - 16 * Math.abs(Math.sin(x * 0.045 + 1)) - 7 * Math.sin(x * 0.11 + 3));
      g.fillStyle = p.far;
      g.fillRect(x, top, 1, H - top);
      if (top < 52) {
        g.fillStyle = p.farSnow;
        g.fillRect(x, top, 1, Math.min(3, 52 - top));
      }
    }

    // Rolling hills.
    for (let x = 0; x < this.w; x++) {
      const top = Math.round(80 - 6 * Math.sin(x * 0.035) - 3 * Math.sin(x * 0.09 + 2));
      g.fillStyle = p.hills;
      g.fillRect(x, top, 1, H - top);
    }

    // Foreground ground with a grassy edge.
    const groundTop = (x: number) => Math.round(96 - 2 * Math.sin(x * 0.05 + 1));
    for (let x = 0; x < this.w; x++) {
      const top = groundTop(x);
      g.fillStyle = p.ground;
      g.fillRect(x, top, 1, H - top);
      g.fillStyle = p.grass;
      g.fillRect(x, top, 1, x % 3 === 0 ? 2 : 1);
    }

    // Pine trees on the hills.
    for (let i = 0; i < Math.floor(this.w / 14); i++) {
      const x = Math.round(rand(i, 7) * this.w);
      const base = Math.round(82 - 6 * Math.sin(x * 0.035) - 3 * Math.sin(x * 0.09 + 2)) + 2;
      this.pine(g, x, base, 4 + Math.floor(rand(i, 8) * 4), p);
    }

    // A small house with a chimney.
    const hx = Math.round(this.w * 0.68);
    const hy = groundTop(hx);
    this.house(g, hx, hy, p);

    // Foreground pines framing the house.
    this.pine(g, hx - 10, groundTop(hx - 10) + 1, 9, p);
    this.pine(g, hx + 22, groundTop(hx + 22) + 1, 7, p);
    this.pine(g, Math.round(this.w * 0.15), groundTop(Math.round(this.w * 0.15)) + 1, 10, p);
    return c;
  }

  private pine(g: CanvasRenderingContext2D, x: number, base: number, height: number, p: Palette) {
    g.fillStyle = '#4a3020';
    g.fillRect(x, base - 2, 1, 2);
    for (let row = 0; row < height; row++) {
      const half = Math.floor((height - row) / 2.2) + (row % 3 === 0 ? 1 : 0);
      g.fillStyle = row % 3 === 0 ? p.treeDark : p.tree;
      g.fillRect(x - half, base - 2 - row, half * 2 + 1, 1);
    }
    if (this.sky() === 'snow') {
      g.fillStyle = '#ffffff';
      g.fillRect(x, base - 2 - height, 1, 1);
      g.fillRect(x - 1, base - 1 - height, 3, 1);
    }
  }

  private house(g: CanvasRenderingContext2D, x: number, ground: number, p: Palette) {
    const night = !this.isDay();
    g.fillStyle = night ? '#5a4636' : '#c98b5a';
    g.fillRect(x, ground - 9, 14, 9);                 // walls
    g.fillStyle = night ? '#3c2c22' : '#9c6640';
    g.fillRect(x, ground - 9, 14, 1);
    g.fillStyle = night ? '#5c2525' : '#b23b3b';
    for (let r = 0; r < 6; r++) g.fillRect(x - 2 + r, ground - 10 - r, 18 - r * 2, 1); // roof
    if (this.sky() === 'snow') {
      g.fillStyle = '#ffffff';
      for (let r = 2; r < 6; r++) g.fillRect(x - 2 + r, ground - 10 - r, 18 - r * 2, 1);
    }
    g.fillStyle = night ? '#4a3a30' : '#7a5236';
    g.fillRect(x + 10, ground - 17, 2, 4);            // chimney
    g.fillStyle = '#3a2416';
    g.fillRect(x + 2, ground - 6, 3, 6);              // door
    g.fillStyle = night ? p.window : '#a8d8f0';
    g.fillRect(x + 8, ground - 7, 4, 3);              // window
  }

  private draw() {
    const g = this.ctx!;
    const p = this.palette;
    const sky = this.sky();
    const t = this.frame++;

    // Sky in hard bands with a dithered edge between each one.
    const band = Math.ceil(70 / p.sky.length);
    for (let i = 0; i < p.sky.length; i++) {
      g.fillStyle = p.sky[i];
      g.fillRect(0, i * band, this.w, band);
      if (i > 0) {
        g.fillStyle = p.sky[i - 1];
        for (let x = (i % 2); x < this.w; x += 2) g.fillRect(x, i * band, 1, 1);
      }
    }
    g.fillStyle = p.sky[p.sky.length - 1];
    g.fillRect(0, 70, this.w, H - 70);

    // Stars at night when the sky is clear enough.
    if (!this.isDay() && (sky === 'clear' || sky === 'partly')) {
      for (let i = 0; i < 60; i++) {
        const twinkle = (t / 30 + i * 1.7) % 6 < 1;
        g.fillStyle = twinkle ? '#7f8bd0' : '#f2f4ff';
        g.fillRect(Math.floor(rand(i, 11) * this.w), Math.floor(rand(i, 12) * 55), 1, 1);
      }
    }

    // Sun or moon.
    if (sky === 'clear' || sky === 'partly') {
      const cx = Math.round(this.w * 0.22);
      if (this.isDay()) {
        disc(g, cx, 22, 9, '#ffe9a0');
        disc(g, cx, 22, 7, '#ffd23f');
        if (Math.floor(t / 40) % 2 === 0) {            // blinking rays
          g.fillStyle = '#ffe9a0';
          for (const [dx, dy] of [[0, -13], [0, 12], [-13, 0], [12, 0], [-9, -9], [8, -9], [-9, 8], [8, 8]]) {
            g.fillRect(cx + dx, 22 + dy, 2, 2);
          }
        }
      } else {
        disc(g, cx, 20, 7, '#f4f1d6');
        disc(g, cx + 3, 18, 6, p.sky[1]);             // crescent cut-out
      }
    }

    g.drawImage(this.terrain!, 0, 0);

    // Clouds drift slowly and wrap around.
    for (const c of this.clouds) {
      c.x += c.speed;
      if (c.x - c.size * 3 > this.w) c.x = -c.size * 3;
      this.cloud(g, Math.round(c.x), Math.round(c.y), c.size, p);
    }

    // Fog banks.
    if (sky === 'fog') {
      g.fillStyle = 'rgba(220, 224, 230, 0.45)';
      for (let i = 0; i < 4; i++) {
        const y = 60 + i * 12;
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
      if (d.y > H) { d.y = -3; d.x = Math.random() * (this.w + 20); }
      if (d.x < -2) d.x = this.w;
    }

    // Lightning.
    if (sky === 'storm') {
      if (this.flash === 0 && Math.random() < 0.004) this.flash = 12;
      if (this.flash > 0) {
        this.flash--;
        if (this.flash > 8) {
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.fillRect(0, 0, this.w, H);
          this.bolt(g, Math.round(this.w * 0.55), 12);
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
