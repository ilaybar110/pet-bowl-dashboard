import {
  doc, onSnapshot, collection, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configured, relativeTime } from "./shared.js";

// If the device stops reporting for this long, the reading on screen is no
// longer trustworthy -- most likely the ESP32 lost WiFi or power.
const STALE_AFTER_MS = 5 * 60 * 1000;

// Bowl geometry in the SVG's viewBox units. The bowl tapers, so the water's
// surface ellipse has to shrink as the level drops -- a fixed-size surface
// would visibly overhang the walls when the bowl is nearly empty.
const RIM = { y: 36, rx: 96, ry: 8 };
const BASE = { y: 116, rx: 50, ry: 5 };
const BOWL_CX = 120;

function surfaceAt(pct) {
  const y = BASE.y - (pct / 100) * (BASE.y - RIM.y);
  const t = (y - RIM.y) / (BASE.y - RIM.y); // 0 at the rim, 1 at the base
  return {
    y,
    rx: RIM.rx + t * (BASE.rx - RIM.rx),
    ry: RIM.ry + t * (BASE.ry - RIM.ry),
  };
}

// Used only until the device reports its own capacity.
const FALLBACK_CAPACITY_G = 1049;

const el = {
  conn: document.getElementById("conn"),
  card: document.getElementById("card"),
  badge: document.getElementById("badge"),
  updated: document.getElementById("updated"),
  water: document.getElementById("water"),
  surface: document.getElementById("surface"),
  pct: document.getElementById("pct"),
  grams: document.getElementById("grams"),
  lastRefill: document.getElementById("lastRefill"),
  refillList: document.getElementById("refillList"),
  refillEmpty: document.getElementById("refillEmpty"),
  hint: document.getElementById("hint"),
  chart: document.getElementById("chart"),
  chartEmpty: document.getElementById("chartEmpty"),
  thresholds: document.getElementById("thresholds"),
};

if (!configured) {
  el.conn.textContent = "not configured";
  el.conn.dataset.state = "error";
  el.hint.textContent =
    "Fill in your Firebase apiKey and projectId in firebase-config.js.";
  throw new Error("firebase-config.js still has placeholder values");
}

let latest = null;

// Counting the number up/down matches the water's glide -- snapping the digits
// while the level animates looks broken.
let pctAnim = null;
let shownPct = 0;

function animatePct(to) {
  if (pctAnim) cancelAnimationFrame(pctAnim);
  const from = shownPct;
  const delta = to - from;
  if (Math.abs(delta) < 0.5) {
    shownPct = to;
    el.pct.textContent = Math.round(to);
    return;
  }
  const start = performance.now();
  const DURATION = 1400;

  const step = (now) => {
    const t = Math.min((now - start) / DURATION, 1);
    // Same easing curve as the water transition in CSS.
    const eased = 1 - Math.pow(1 - t, 3);
    shownPct = from + delta * eased;
    el.pct.textContent = Math.round(shownPct);
    if (t < 1) pctAnim = requestAnimationFrame(step);
  };
  pctAnim = requestAnimationFrame(step);
}

function render() {
  if (!latest) return;

  const { weightG, state, updatedAt, lowThresholdG, refillThresholdG } = latest;
  const capacity = latest.fullCapacityG || FALLBACK_CAPACITY_G;
  const when = updatedAt?.toDate ? updatedAt.toDate() : null;
  const stale = when ? Date.now() - when.getTime() > STALE_AFTER_MS : true;

  const pct = Math.max(0, Math.min(100, (weightG / capacity) * 100));
  const removed = !stale && state === "REMOVED";

  // A stale reading gets neutral styling so an old "OK" can't look reassuring.
  el.card.dataset.state = stale ? "unknown" : state;
  el.badge.textContent = stale ? "stale" : removed ? "no bowl" : state;
  el.updated.textContent = when ? relativeTime(when) : "unknown";

  // With the bowl off the scale there is no water level to show, so the
  // percentage would be meaningless rather than merely zero.
  const surf = surfaceAt(removed ? 0 : pct);
  el.water.style.transform = `translateY(${surf.y}px)`;
  el.surface.style.transform =
    `translate(${BOWL_CX}px, ${surf.y}px) scale(${surf.rx}, ${surf.ry})`;

  if (removed) {
    if (pctAnim) cancelAnimationFrame(pctAnim);
    shownPct = 0;
    el.pct.textContent = "--";
    el.grams.textContent = "";
  } else {
    animatePct(pct);
    el.grams.textContent =
      `${Math.max(0, Math.round(weightG))} g of ${Math.round(capacity)} g`;
  }

  const refilledAt = latest.lastRefillAt?.toDate ? latest.lastRefillAt.toDate() : null;
  el.lastRefill.textContent = refilledAt
    ? `Last refilled ${relativeTime(refilledAt)}`
    : "No refill recorded yet";

  el.hint.textContent = stale
    ? "No update in a while -- check that the scale has power and WiFi."
    : removed
      ? "Bowl not on SmartBowl"
      : state === "LOW"
        ? "Bowl needs a refill."
        : "";

  el.thresholds.textContent =
    `alerts below ${Math.round(lowThresholdG || 0)}g / clears above ${Math.round(refillThresholdG || 0)}g`;
}

function drawChart(points) {
  if (points.length < 2) {
    el.chart.innerHTML = "";
    el.chartEmpty.hidden = false;
    return;
  }
  el.chartEmpty.hidden = true;

  const W = 600, H = 160, pad = 8;
  const xs = points.map((p) => p.at.getTime());
  const ys = points.map((p) => p.weightG);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const maxY = Math.max(...ys, latest?.refillThresholdG || 0, 1);

  const px = (x) => pad + ((x - minX) / Math.max(maxX - minX, 1)) * (W - pad * 2);
  const py = (y) => H - pad - (y / maxY) * (H - pad * 2);

  const line = points.map((p, i) =>
    `${i ? "L" : "M"}${px(p.at.getTime()).toFixed(1)},${py(p.weightG).toFixed(1)}`
  ).join(" ");
  const area = `${line} L${px(maxX).toFixed(1)},${H - pad} L${px(minX).toFixed(1)},${H - pad} Z`;

  const threshY = py(latest?.lowThresholdG || 0).toFixed(1);

  el.chart.innerHTML =
    `<path class="area" d="${area}"/>` +
    `<path class="line" d="${line}"/>` +
    `<line class="thresh" x1="${pad}" y1="${threshY}" x2="${W - pad}" y2="${threshY}"/>`;
}

onSnapshot(
  doc(db, "bowl", "latest"),
  (snap) => {
    el.conn.textContent = "live";
    el.conn.dataset.state = "live";
    if (snap.exists()) {
      latest = snap.data();
      render();
    } else {
      el.hint.textContent = "No data yet -- waiting for the scale's first report.";
    }
  },
  (err) => {
    el.conn.textContent = "connection error";
    el.conn.dataset.state = "error";
    el.hint.textContent = err.message;
  }
);

onSnapshot(
  query(collection(db, "readings"), orderBy("at", "desc"), limit(200)),
  (snap) => {
    const points = snap.docs
      .map((d) => d.data())
      .filter((r) => r.at?.toDate)
      .map((r) => ({ weightG: r.weightG, at: r.at.toDate() }))
      .reverse(); // Firestore gives newest-first; the chart reads left-to-right
    drawChart(points);
  },
  () => { /* history is best-effort; the live reading above still works */ }
);

function renderRefills(rows) {
  el.refillEmpty.hidden = rows.length > 0;
  el.refillList.innerHTML = rows.map((r) => {
    const when = r.at.toLocaleString([], {
      weekday: "short", hour: "2-digit", minute: "2-digit",
    });
    return `<li class="event-row">
      <span class="event-when">${when}</span>
      <span class="event-ago">${relativeTime(r.at)}</span>
      <span class="event-amt refill">+${Math.round(r.amountG)} ml</span>
    </li>`;
  }).join("");
}

let refillRows = [];

onSnapshot(
  query(collection(db, "refills"), orderBy("at", "desc"), limit(10)),
  (snap) => {
    refillRows = snap.docs
      .map((d) => d.data())
      .filter((r) => r.at?.toDate)
      .map((r) => ({ amountG: r.amountG || 0, at: r.at.toDate() }));
    renderRefills(refillRows);
  },
  () => { /* best-effort, same as history */ }
);

// Keep the "x min ago" labels honest even when no new data arrives.
setInterval(() => {
  render();
  renderRefills(refillRows);
}, 15000);
