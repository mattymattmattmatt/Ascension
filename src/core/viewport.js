// core/viewport.js — keeping the game still under a thumb.
//
// A pausable real-time sim that you tap forty times a minute is unplayable if
// half those taps zoom the page. `user-scalable=no` has been ignored by iOS
// Safari since iOS 10, so the zoom has to be refused directly:
//
//   - pinch      -> iOS fires non-standard gesture* events; cancel them
//   - double-tap -> cancel the second tap inside the double-tap threshold
//   - ctrl+wheel -> desktop trackpad pinch
//   - overscroll -> pull-to-refresh yanking the page mid-run
//
// Fullscreen is offered where the API exists (Android, desktop). iPhone Safari
// has no Fullscreen API, so there the honest answer is Add to Home Screen,
// which we detect and prompt for once.

const DOUBLE_TAP_MS = 320;

export class Viewport {
  constructor() {
    this.lastTouchEnd = 0;
    this.locked = false;
  }

  install() {
    if (this.locked) return;
    this.locked = true;

    // ── Pinch (iOS Safari's non-standard gesture events) ─────────────
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    }

    // ── Pinch (everything else): more than one finger is never a game input
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    // ── Double-tap zoom ──────────────────────────────────────────────
    // Cancelling the second tap of a double-tap stops the zoom without
    // costing the first tap, which is a real button press.
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - this.lastTouchEnd <= DOUBLE_TAP_MS) e.preventDefault();
      this.lastTouchEnd = now;
    }, { passive: false });

    // ── Trackpad pinch on desktop ────────────────────────────────────
    document.addEventListener('wheel', (e) => {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });

    // ── Pull-to-refresh, and rubber-banding the whole page ───────────
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';

    // ── Address-bar height changes ───────────────────────────────────
    // dvh units are not everywhere yet, so also publish the real height as
    // a custom property and keep it current.
    const setH = () => {
      const h = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--vh', `${h}px`);
    };
    setH();
    window.addEventListener('resize', setH);
    window.addEventListener('orientationchange', () => setTimeout(setH, 120));
    window.visualViewport?.addEventListener('resize', setH);

    // If the page does get zoomed anyway (assistive zoom, an OS gesture we
    // cannot see), scroll back so the UI is not left half off-screen.
    window.visualViewport?.addEventListener('scroll', () => {
      if ((window.visualViewport.scale || 1) <= 1.01) window.scrollTo(0, 0);
    });
  }

  // ── Fullscreen ─────────────────────────────────────────────────────
  static supported() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  static isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  static isStandalone() {
    return window.matchMedia?.('(display-mode: fullscreen)').matches
      || window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  static async enter() {
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      // Landscape lock is a nice-to-have and throws on most browsers; the
      // game plays fine either way, so a failure here is not worth surfacing.
      try { await screen.orientation?.lock?.('any'); } catch { /* not supported */ }
      return true;
    } catch { return false; }
  }

  static async exit() {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return true;
    } catch { return false; }
  }

  static async toggle() {
    return Viewport.isFullscreen() ? Viewport.exit() : Viewport.enter();
  }

  // iPhone Safari has no Fullscreen API. Installing to the home screen is
  // the only way to lose the browser chrome, so say so once, plainly.
  static iosNeedsInstall() {
    const ios = /iP(hone|od|ad)/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return ios && !Viewport.supported() && !Viewport.isStandalone();
  }
}

export default Viewport;
