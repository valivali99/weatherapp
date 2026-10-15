import { Component, computed, input } from '@angular/core';
import { Sky } from './weather.service';

type Grid = (string | null)[][];
interface Run { x: number; y: number; w: number; color: string; }

const N = 16;
const SUN = '#ffd23f', SUN_LIGHT = '#fff1a8', MOON = '#f4f1d6';
const CLOUD = '#ffffff', CLOUD_SHADE = '#b9c8dc', DARK = '#6b7488', DARK_SHADE = '#4a5164';
const RAIN = '#4aa3ff', BOLT = '#ffe14a', OUTLINE = '#1b1f33';

/** 16×16 pixel weather icon, built from simple shapes and rendered as crisp SVG rects. */
@Component({
  selector: 'app-pixel-icon',
  template: `
    <svg viewBox="0 0 16 16" shape-rendering="crispEdges" [attr.width]="size()" [attr.height]="size()" role="img" [attr.aria-label]="sky()">
      @for (r of runs(); track $index) {
        <rect [attr.x]="r.x" [attr.y]="r.y" [attr.width]="r.w" height="1" [attr.fill]="r.color" />
      }
    </svg>
  `,
  styles: `:host { display: inline-block; line-height: 0; }`,
})
export class PixelIconComponent {
  sky = input.required<Sky>();
  night = input(false);
  size = input(48);

  runs = computed(() => toRuns(outline(sprite(this.sky(), this.night()))));
}

function sprite(sky: Sky, night: boolean): Grid {
  const g: Grid = Array.from({ length: N }, () => Array(N).fill(null));
  const body = (x: number, y: number, r: number) => night ? moon(g, x, y, r) : sun(g, x, y, r);

  switch (sky) {
    case 'clear':
      body(8, 8, 5);
      break;
    case 'partly':
      body(6, 6, 4);
      cloud(g, 9, 11, CLOUD, CLOUD_SHADE);
      break;
    case 'cloudy':
      cloud(g, 6, 7, CLOUD_SHADE, DARK);
      cloud(g, 9, 10, CLOUD, CLOUD_SHADE);
      break;
    case 'fog':
      for (const [y, x0, x1] of [[5, 2, 12], [8, 4, 14], [11, 1, 11], [14, 5, 14]]) {
        for (let x = x0; x <= x1; x++) g[y][x] = CLOUD_SHADE;
      }
      break;
    case 'rain':
      cloud(g, 8, 6, CLOUD, CLOUD_SHADE);
      for (const [x, y] of [[4, 11], [8, 12], [12, 11], [6, 14], [10, 14]]) {
        g[y][x] = RAIN;
        g[y + 1]?.splice(x - 1, 1, RAIN);
      }
      break;
    case 'snow':
      cloud(g, 8, 6, CLOUD, CLOUD_SHADE);
      for (const [x, y] of [[4, 12], [8, 13], [12, 12], [6, 15], [10, 15]]) {
        g[y][x] = CLOUD;
        if (y - 1 > 10) g[y - 1][x] = CLOUD_SHADE;
      }
      break;
    case 'storm':
      cloud(g, 8, 6, DARK, DARK_SHADE);
      for (const [x, y] of [[9, 10], [8, 11], [7, 12], [8, 12], [9, 12], [8, 13], [7, 14], [6, 15]]) g[y][x] = BOLT;
      break;
  }
  return g;
}

function disc(g: Grid, cx: number, cy: number, r: number, color: string | null) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.6) g[y][x] = color;
    }
  }
}

function sun(g: Grid, cx: number, cy: number, r: number) {
  disc(g, cx, cy, r, SUN);
  disc(g, cx - 1, cy - 1, Math.max(1, r - 3), SUN_LIGHT);
  const d = r + 2;
  for (const [dx, dy] of [[0, -d], [0, d], [-d, 0], [d, 0]]) set(g, cx + dx, cy + dy, SUN);
  const k = Math.round(d * 0.75);
  for (const [dx, dy] of [[-k, -k], [k, -k], [-k, k], [k, k]]) set(g, cx + dx, cy + dy, SUN);
}

function moon(g: Grid, cx: number, cy: number, r: number) {
  disc(g, cx, cy, r, MOON);
  disc(g, cx + Math.ceil(r / 2), cy - Math.ceil(r / 2), r - 1, null);
}

function cloud(g: Grid, cx: number, cy: number, color: string, shade: string) {
  disc(g, cx - 4, cy + 1, 2, shade);
  disc(g, cx, cy, 3, shade);
  disc(g, cx + 4, cy + 1, 2, shade);
  for (let x = cx - 5; x <= cx + 5; x++) set(g, x, cy + 3, shade);
  disc(g, cx - 4, cy, 2, color);
  disc(g, cx, cy - 1, 3, color);
  disc(g, cx + 4, cy, 2, color);
  for (let x = cx - 4; x <= cx + 4; x++) set(g, x, cy + 2, color);
}

function set(g: Grid, x: number, y: number, color: string | null) {
  if (x >= 0 && x < N && y >= 0 && y < N) g[y][x] = color;
}

/** Adds a dark 1px outline around every filled pixel — the classic sprite look. */
function outline(g: Grid): Grid {
  const out = g.map((row) => [...row]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (g[y][x]) continue;
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx]);
      if (touches) out[y][x] = OUTLINE;
    }
  }
  return out;
}

/** Merges horizontal pixels of the same color so the SVG stays small. */
function toRuns(g: Grid): Run[] {
  const runs: Run[] = [];
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      const color = g[y][x];
      let w = 1;
      while (color && g[y][x + w] === color) w++;
      if (color) runs.push({ x, y, w, color });
      x += w;
    }
  }
  return runs;
}
