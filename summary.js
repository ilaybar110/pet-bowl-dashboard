// The four glance tiles. Everything here is a restatement of what the panels
// below already show, except the dry-out projection, which is the one figure
// on the page that looks forward instead of back.
//
// Every query below is byte-identical to one app.js or stats.js already
// opens. The Firestore SDK shares a single stream per distinct query within a
// client, so these listeners cost no extra reads -- keep them identical.

import {
  doc, onSnapshot, collection, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configured, relativeTime } from "./shared.js";

if (!configured) throw new Error("firebase not configured");

const el = {
  drinkValue: document.getElementById("sumDrinkValue"),
  drinkSub: document.getElementById("sumDrinkSub"),
  refillValue: document.getElementById("sumRefillValue"),
  refillSub: document.getElementById("sumRefillSub"),
  todayValue: document.getElementById("sumTodayValue"),
  todaySub: document.getElementById("sumTodaySub"),
  dryTile: document.getElementById("sumDryTile"),
  dryValue: document.getElementById("sumDryValue"),
  drySub: document.getElementById("sumDrySub"),
};

let latest = null;
let days = [];
let lastDrink = null;
let lastRefill = null;

function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A count of digits is easier to compare across tiles than a raw integer.
function ml(n) {
  return Math.round(n).toLocaleString();
}

function renderEvents() {
  if (lastDrink) {
    el.drinkValue.textContent = relativeTime(lastDrink.at);
    const dur = lastDrink.durationS ? ` over ${lastDrink.durationS}s` : "";
    el.drinkSub.textContent = `${ml(lastDrink.amountG)} ml${dur}`;
  }
  if (lastRefill) {
    el.refillValue.textContent = relativeTime(lastRefill.at);
    el.refillSub.textContent = `${ml(lastRefill.amountG)} ml added`;
  }
}

function renderToday() {
  if (!latest) return;

  const total = Math.max(0, latest.todayTotalG || 0);
  const sessions = latest.drinkCountToday || 0;

  el.todayValue.innerHTML = `${ml(total)}<span class="tile-unit">ml</span>`;
  el.todaySub.textContent =
    sessions === 0 ? "no drinks yet" : sessions === 1 ? "1 drink" : `${sessions} drinks`;
}

// Hours until the level reaches the low threshold -- the point the device
// itself starts pushing notifications, which is the moment that actually
// matters rather than a theoretically empty bowl.
//
// The pace comes from finished days only. Today is still accumulating, so
// using it would make the bowl look like it lasts forever every morning.
// Evaporation is deliberately excluded: it is roughly 0.25 g per 5-minute
// window, which is noise against a dog's drinking.
function renderDryOut() {
  if (!latest) return;

  const grams = Math.max(0, latest.weightG || 0);
  const low = latest.lowThresholdG || 0;
  const headroom = grams - low;

  if (latest.state === "REMOVED") {
    el.dryTile.dataset.state = "";
    el.dryValue.textContent = "--";
    el.drySub.textContent = "bowl is off the scale";
    return;
  }

  if (headroom <= 0) {
    el.dryTile.dataset.state = "now";
    el.dryValue.textContent = "Now";
    el.drySub.textContent = `below the ${ml(low)} ml alert line`;
    return;
  }

  const finished = days.filter((d) => d.date !== todayKey());
  const recent = finished.slice(-7);
  if (recent.length < 2) {
    el.dryTile.dataset.state = "";
    el.dryValue.textContent = "--";
    el.drySub.textContent = `${ml(headroom)} ml left, pace unknown`;
    return;
  }

  const perDay = recent.reduce((a, b) => a + b.totalG, 0) / recent.length;
  const perHour = perDay / 24;

  if (perHour <= 0) {
    el.dryTile.dataset.state = "";
    el.dryValue.textContent = "--";
    el.drySub.textContent = `${ml(headroom)} ml left, pace unknown`;
    return;
  }

  const hours = headroom / perHour;

  // Under a day, hours are actionable. Past that, days are -- "38h" invites
  // arithmetic nobody wants to do.
  el.dryValue.textContent =
    hours < 1 ? "<1h" : hours < 24 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)}d`;

  el.dryTile.dataset.state = hours < 6 ? "soon" : "";
  el.drySub.textContent =
    `${ml(headroom)} ml left at the ${recent.length}-day pace`;
}

onSnapshot(doc(db, "bowl", "latest"), (snap) => {
  if (!snap.exists()) return;
  latest = snap.data();
  renderToday();
  renderDryOut();
});

onSnapshot(
  query(collection(db, "drinks"), orderBy("at", "desc"), limit(12)),
  (snap) => {
    const rows = snap.docs.map((d) => d.data()).filter((r) => r.at?.toDate);
    if (!rows.length) return;
    lastDrink = {
      amountG: rows[0].amountG || 0,
      durationS: Number(rows[0].durationS || 0),
      at: rows[0].at.toDate(),
    };
    renderEvents();
  },
  () => { /* best-effort, same as the panels below */ }
);

onSnapshot(
  query(collection(db, "refills"), orderBy("at", "desc"), limit(10)),
  (snap) => {
    const rows = snap.docs.map((d) => d.data()).filter((r) => r.at?.toDate);
    if (!rows.length) return;
    lastRefill = { amountG: rows[0].amountG || 0, at: rows[0].at.toDate() };
    renderEvents();
  },
  () => { /* best-effort */ }
);

onSnapshot(
  query(collection(db, "days"), orderBy("date", "desc"), limit(30)),
  (snap) => {
    days = snap.docs
      .map((d) => d.data())
      .filter((d) => d.date)
      .map((d) => ({ date: d.date, totalG: d.totalG || 0 }))
      .reverse(); // oldest-first, matching stats.js
    renderDryOut();
  },
  () => { /* best-effort */ }
);

// The two event tiles show relative times, which rot silently. The dry-out
// projection drifts for the same reason.
setInterval(() => {
  renderEvents();
  renderDryOut();
}, 30000);
