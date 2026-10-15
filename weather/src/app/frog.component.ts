import { Component, ElementRef, OnDestroy, afterNextRender, signal, viewChild } from '@angular/core';

/** Seconds the frog sits still between leaps. */
const REST_MS = 5000;
const LEAP_MS = 1400;
/** Gap between the frog and the screen edge. */
const MARGIN = 16;
/** Displayed width of the sitting frog (matches .idle in the styles). */
const FROG_W = 64;

/**
 * A frog that sits in the bottom-left corner, then every few seconds leaps
 * across the screen to the opposite corner, and back again.
 */
@Component({
  selector: 'app-frog',
  template: `
    <div class="mover" #mover>
      <div class="hop" #hop>
        <!-- Both sprites stay in the DOM so swapping between them never flickers. -->
        <img #idle class="idle" src="frog/sprites/frog-idle.png" alt="" [hidden]="leaping()" />
        <img class="leap" src="frog/sprites/frog-leap.png" alt="" [hidden]="!leaping()" [class.flip]="goingLeft()" />
      </div>
    </div>
  `,
  styles: `
    :host { position: fixed; left: 16px; bottom: 8px; z-index: 10; pointer-events: none; }
    .mover, .hop { width: 64px; height: 72px; position: relative; will-change: transform; }
    img { position: absolute; bottom: 0; filter: drop-shadow(3px 3px 0 rgba(0, 0, 0, 0.35)); }
    img[hidden] { display: none; }
    .idle { left: 0; width: 64px; transform-origin: bottom center; }
    .leap { left: 50%; width: 101px; bottom: 6px; transform: translateX(-50%); }
    .leap.flip { transform: translateX(-50%) scaleX(-1); }
  `,
})
export class FrogComponent implements OnDestroy {
  leaping = signal(false);
  goingLeft = signal(false);

  private mover = viewChild.required<ElementRef<HTMLElement>>('mover');
  private hop = viewChild.required<ElementRef<HTMLElement>>('hop');
  private idle = viewChild.required<ElementRef<HTMLElement>>('idle');
  private onRight = false;
  private timer?: ReturnType<typeof setTimeout>;
  private onResize = () => {
    if (!this.leaping()) this.mover().nativeElement.style.transform = `translateX(${this.xFor(this.onRight)}px)`;
  };

  constructor() {
    // Timers and animations only make sense in the browser, not during server rendering.
    afterNextRender(() => {
      window.addEventListener('resize', this.onResize);
      this.scheduleLeap();
    });
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onResize);
  }

  /** Horizontal offset of the left or right resting spot. */
  private xFor(right: boolean) {
    return right ? Math.max(0, window.innerWidth - FROG_W - MARGIN * 2) : 0;
  }

  private scheduleLeap() {
    this.timer = setTimeout(() => this.leap(), REST_MS);
  }

  private leap() {
    const from = this.xFor(this.onRight);
    const to = this.xFor(!this.onRight);
    const height = Math.min(window.innerHeight * 0.35, 220);
    const mover = this.mover().nativeElement;
    const hop = this.hop().nativeElement;

    this.goingLeft.set(this.onRight);
    this.leaping.set(true);

    // Sideways at a steady speed, while the vertical part rises fast and falls back like gravity.
    const across = mover.animate(
      [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
      { duration: LEAP_MS, easing: 'linear', fill: 'forwards' },
    );
    hop.animate(
      [
        { transform: 'translateY(0)', easing: 'cubic-bezier(0.25, 0.6, 0.45, 1)' },
        { transform: `translateY(${-height}px)`, offset: 0.5, easing: 'cubic-bezier(0.55, 0, 0.75, 0.4)' },
        { transform: 'translateY(0)' },
      ],
      { duration: LEAP_MS },
    );

    across.onfinish = () => {
      mover.style.transform = `translateX(${to}px)`;
      across.cancel();
      this.onRight = !this.onRight;
      this.leaping.set(false);
      // A little squash as she lands.
      this.idle().nativeElement.animate(
        [{ transform: 'scale(1.15, 0.8)' }, { transform: 'scale(1, 1)' }],
        { duration: 220, easing: 'ease-out' },
      );
      this.scheduleLeap();
    };
  }
}
