import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, onSnapshot, collection, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// If the device stops reporting for this long, the reading on screen is no
// longer trustworthy -- most likely the ESP32 lost WiFi or power.
const STALE_AFTER_MS = 5 * 60 * 1000;

const el = {
  conn: document.getElementById("conn"),
  card: document.getElementById("card"),
  badge: document.getElementById("badge"),
  updated: document.getElementById("updated"),
  weight: document.getElementById("weight"),
  meterFill: document.getElementById("meterFill"),
  meterMark: document.getElementById("meterMark"),
  hint: document.getElementById("hint"),
  chart: document.getElementById("chart"),
  chartEmpty: document.getElementById("chartEmpty"),
  thresholds: document.getElementById("thresholds"),
};

if (firebaseConfig.apiKey.startsWith("PASTE_")) {
  el.conn.textContent = "not configured";
  el.conn.dataset.state = "error";
  el.hint.textContent =
    "Fill in your Firebase apiKey and projectId in web/firebase-config.js.";
  throw new Error("firebase-config.js still has placeholder values");
}

const db = getFirestore(initializeApp(firebaseConfig));

// Latest reading drives everything above the fold.
let latest = null;

function relativeTime(date) {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function render() {
  if (!latest) return;

  const { weightG, state, updatedAt, lowThresholdG, refillThresholdG } = latest;
  const when = updatedAt?.toDate ? updatedAt.toDate() : null;
  const stale = when ? Date.now() - when.getTime() > STALE_AFTER_MS : true;

  el.weight.textContent = Math.round(weightG);

  // A stale reading gets neutral styling so an old "OK" can't look reassuring.
  el.card.dataset.state = stale ? "unknown" : state;
  el.badge.textContent = stale ? "stale" : state;
  el.updated.textContent = when ? relativeTime(when) : "unknown";

  el.hint.textContent = stale
    ? "No update in a while -- check that the scale has power and WiFi."
    : state === "LOW"
      ? "Bowl needs a refill."
      : "";

  // The meter is scaled against the refill threshold, so a full bowl sits
  // near the right edge and the marker shows where "low" begins.
  const span = Math.max(refillThresholdG || 0, weightG, 1);
  el.meterFill.style.width = `${Math.max(0, Math.min(100, (weightG / span) * 100))}%`;
  el.meterMark.style.left = `${Math.min(100, ((lowThresholdG || 0) / span) * 100)}%`;

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

// Keep the "x min ago" label honest even when no new data arrives.
setInterval(render, 15000);
