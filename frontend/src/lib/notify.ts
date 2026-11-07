let ctx: AudioContext | undefined;
/** Short, quiet tone. Only called when the user has sound notifications enabled. */
export function beep() {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 660;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.12);
  } catch { /* audio may be blocked until user interaction */ }
}
