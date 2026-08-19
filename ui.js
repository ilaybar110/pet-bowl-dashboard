// Presentation-only behaviour for pro.html. It reads no data and owns no
// state that app.js or stats.js care about -- pull this file and the page
// still works, just flatter.

(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // ---- First-snapshot flag -------------------------------------------------
  // The readout shimmers until real data lands. app.js writes data-state on
  // every render, including for stale readings, so "unknown" alone can't tell
  // "nothing yet" from "old but real". The first write is the signal.
  const card = document.getElementById("card");
  if (card) {
    const obs = new MutationObserver(() => {
      card.dataset.ready = "";
      obs.disconnect();
    });
    obs.observe(card, { attributeFilter: ["data-state"] });
  }

  if (reduced || !fine) return;

  // ---- Spotlight border ----------------------------------------------------
  // One delegated listener on the whole shell rather than one per surface,
  // and the write is deferred to a frame so a fast sweep across a dozen of
  // them still costs a single style recalculation per frame.
  const shell = document.querySelector(".shell");
  if (shell) {
    let pending = null;
    let queued = false;

    shell.addEventListener("pointermove", (e) => {
      const panel = e.target.closest(".panel, .tile");
      if (!panel) return;
      pending = { panel, x: e.clientX, y: e.clientY };
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const { panel: p, x, y } = pending;
        const r = p.getBoundingClientRect();
        p.style.setProperty("--mx", `${x - r.left}px`);
        p.style.setProperty("--my", `${y - r.top}px`);
      });
    }, { passive: true });
  }

  // ---- Magnetic control ----------------------------------------------------
  // Uses the `translate` property, not `transform`, so it composes with the
  // :active press transform instead of overwriting it.
  const PULL = 0.28;      // fraction of the cursor's offset the button follows
  const RADIUS = 90;      // px beyond the button where the pull starts

  document.querySelectorAll(".btn").forEach((btn) => {
    const onMove = (e) => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const near =
        Math.abs(dx) < r.width / 2 + RADIUS &&
        Math.abs(dy) < r.height / 2 + RADIUS;
      btn.style.translate = near ? `${dx * PULL}px ${dy * PULL}px` : "";
    };

    // Tracking from the document is what lets the button reach *toward* the
    // cursor before it arrives; a hover listener could only fire once the
    // pointer is already on top of it.
    document.addEventListener("pointermove", onMove, { passive: true });
    btn.addEventListener("pointerleave", () => { btn.style.translate = ""; });
    btn.addEventListener("blur", () => { btn.style.translate = ""; });
  });
})();
