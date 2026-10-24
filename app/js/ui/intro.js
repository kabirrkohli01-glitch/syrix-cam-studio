// Launch sequence. The logo builds itself (camera blades slide in and their
// rim light traces on, then the lens opens like an eye and the recording
// light comes on) while the app loads behind it. Once loading is done and the
// build has played, the logo flies towards the viewer and fades while the
// live camera settles in from slightly zoomed. The reveal animates only
// opacity and transform, which the compositor runs on its own thread, so it
// stays smooth while the app is still busy; the earlier full-screen mask was
// repainted on the main thread every frame and stuttered.

const BUILD_MS = 2300;

export class Intro {
  constructor(root) {
    this.root = root;
    this.fill = root.querySelector('#intro-fill');
    this.status = root.querySelector('#intro-status');
    this.started = performance.now();
    this.done = false;
    requestAnimationFrame(() => root.classList.add('play'));
  }

  progress(pct, text) {
    this.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, pct / 100))})`;
    if (text) this.status.textContent = text;
  }

  // Waits for the build to finish, then reveals the app through the lens.
  async finish(sfx, firstFrame) {
    if (this.done) return;
    this.done = true;
    const wait = Math.max(0, BUILD_MS - (performance.now() - this.started));
    await new Promise((r) => setTimeout(r, wait + 120));
    // The reveal opens onto the live picture, not a black frame.
    if (firstFrame) await Promise.race([firstFrame, new Promise((r) => setTimeout(r, 1500))]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (sfx) sfx.shutter();
    this.root.classList.add('reveal');
    document.body.classList.add('revealing');
    await new Promise((r) => setTimeout(r, 1150));
    this.root.remove();
    document.body.classList.remove('revealing');
  }
}
