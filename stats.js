// Drinking analytics: how much the dog actually drank, when, and whether
// that's normal for it. Kept separate from app.js, which owns the live bowl.

import {
  doc, onSnapshot, collection, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configured, relativeTime, clockTime } from "./shared.js";

if (!configured) throw new Error("firebase not configured");

// The vet rule of thumb: a healthy dog drinks 50-60 ml per kg per day. 1 ml of
// water weighs 1 g, so the scale's grams are millilitres directly.
const ML_PER_KG_MIN = 50;
const ML_PER_KG_MAX = 60;
const FALLBACK_DOG_KG = 35;

const el = {
  todayMl: document.getElementById("todayMl"),
  todaySessions: document.getElementById("todaySessions"),
  lastDrink: document.getElementById("lastDrink"),
  rangeBand: document.getElementById("rangeBand"),
  rangeFill: document.getElementById("rangeFill"),
  rangeNote: document.getElementById("rangeNote"),
  drinkList: document.getElementById("drinkList"),
  drinkEmpty: document.getElementById("drinkEmpty"),
  hourlyChart: document.getElementById("hourlyChart"),
  hourlyNote: document.getElementById("hourlyNote"),
  heatmap: document.getElementById("heatmap"),
  dailyChart: document.getElementById("dailyChart"),
  trendNote: document.getElementById("trendNote"),
  healthBody: document.getElementById("healthBody"),
  exportCsv: document.getElementById("exportCsv"),
};

let latest = null;

// How far through the local day we are, so an early-morning total isn't
// presented as though the dog is under-drinking.
function dayProgress() {
  const now = new Date();
  return (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
}

function renderToday() {
  if (!latest) return;

  const kg = latest.dogWeightKg || FALLBACK_DOG_KG;
  const expectMin = kg * ML_PER_KG_MIN;
  const expectMax = kg * ML_PER_KG_MAX;
  const today = Math.max(0, latest.todayTotalG || 0);
  const sessions = latest.drinkCountToday || 0;

  el.todayMl.textContent = Math.round(today);
  el.todaySessions.textContent =
    sessions === 1 ? "1 drink" : `${sessions} drinks`;

  const drankAt = latest.lastDrinkAt?.toDate ? latest.lastDrinkAt.toDate() : null;
  el.lastDrink.textContent = drankAt
    ? `last ${relativeTime(drankAt)}`
    : "none yet today";

  // Scale the bar past the expected maximum so an above-range day is still
  // visible rather than pinned at the end.
  const scaleMax = expectMax * 1.4;
  el.rangeBand.style.left = `${(expectMin / scaleMax) * 100}%`;
  el.rangeBand.style.width = `${((expectMax - expectMin) / scaleMax) * 100}%`;
  el.rangeFill.style.width = `${Math.min(100, (today / scaleMax) * 100)}%`;

  // Judging a full-day range at 9am would be meaningless, so compare against
  // the share of the day that has actually elapsed.
  const progress = dayProgress();
  const paceTarget = expectMin * progress;
  let verdict;
  if (progress < 0.25) {
    verdict = "still early in the day";
  } else if (today >= expectMin) {
    verdict = "already within the normal daily range";
  } else if (today >= paceTarget) {
    verdict = "on pace for a normal day";
  } else {
    verdict = "behind the usual pace so far";
  }

  el.rangeNote.textContent =
    `Normal for a ${Math.round(kg)} kg dog is ${Math.round(expectMin)}-${Math.round(expectMax)} ml/day ג€” ${verdict}.`;

  el.rangeFill.dataset.state =
    today > expectMax ? "over" : today >= expectMin ? "in" : "under";
}

function renderDrinks(rows) {
  el.drinkEmpty.hidden = rows.length > 0;
  el.drinkList.innerHTML = rows.map((r) => {
    const dur = r.durationS ? `${r.durationS}s` : "";
    return `<li class="event-row">
      <span class="event-when">${clockTime(r.at)}</span>
      <span class="event-ago">${relativeTime(r.at)}${dur ? ` &middot; ${dur}` : ""}</span>
      <span class="event-amt drink">${Math.round(r.amountG)} ml</span>
    </li>`;
  }).join("");
}

// ---------- Daily history, patterns, and health ----------

let days = []; // oldest-first, one entry per local day

function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Only finished days can be fairly compared against each other -- today is
// still accumulating and would always look low.
function completeDays() {
  const key = todayKey();
  return days.filter((d) => d.date !== key);
}

function expectedRange() {
  const kg = latest?.dogWeightKg || FALLBACK_DOG_KG;
  return { min: kg * ML_PER_KG_MIN, max: kg * ML_PER_KG_MAX, kg };
}

function renderHourly() {
  const key = todayKey();
  const today = days.find((d) => d.date === key);
  const hourly = today?.hourly || new Array(24).fill(0);
  const max = Math.max(...hourly, 1);

  const W = 600, H = 150, pad = 18;
  const barW = (W - pad * 2) / 24;

  const bars = hourly.map((v, h) => {
    const barH = (v / max) * (H - pad * 2);
    const x = pad + h * barW;
    const y = H - pad - barH;
    return `<rect class="hbar" x="${(x + 1).toFixed(1)}" y="${y.toFixed(1)}"
             width="${(barW - 2).toFixed(1)}" height="${Math.max(0, barH).toFixed(1)}" rx="2"/>`;
  }).join("");

  // Label every six hours; 24 labels would collide on a phone.
  const labels = [0, 6, 12, 18].map((h) => {
    const x = pad + h * barW + barW / 2;
    return `<text class="axis" x="${x.toFixed(1)}" y="${H - 4}" text-anchor="middle">${h}:00</text>`;
  }).join("");

  el.hourlyChart.innerHTML = bars + labels;

  const total = hourly.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    el.hourlyNote.textContent = "No drinking recorded yet today.";
  } else {
    const peak = hourly.indexOf(Math.max(...hourly));
    el.hourlyNote.textContent =
      `Busiest hour so far: ${peak}:00-${peak + 1}:00 (${Math.round(hourly[peak])} ml).`;
  }
}

function renderHeatmap() {
  const recent = days.slice(-7);
  if (recent.length === 0) {
    el.heatmap.innerHTML = "";
    return;
  }

  const peak = Math.max(1, ...recent.flatMap((d) => d.hourly || []));

  el.heatmap.innerHTML = recent.map((d) => {
    const label = new Date(`${d.date}T12:00:00`)
      .toLocaleDateString([], { weekday: "short" });
    const cells = (d.hourly || new Array(24).fill(0)).map((v, h) => {
      // Square-root scaling: linear opacity makes everything but the single
      // biggest hour look empty.
      const intensity = v > 0 ? Math.sqrt(v / peak) : 0;
      return `<span class="heat-cell" style="--i:${intensity.toFixed(3)}"
                    title="${d.date} ${h}:00 ג€” ${Math.round(v)} ml"></span>`;
    }).join("");
    return `<div class="heat-row"><span class="heat-label">${label}</span>
              <span class="heat-cells">${cells}</span></div>`;
  }).join("");
}

function renderDaily() {
  const rows = days.slice(-30);
  const { min, max } = expectedRange();

  if (rows.length === 0) {
    el.dailyChart.innerHTML = "";
    el.trendNote.textContent = "No completed days yet.";
    return;
  }

  const W = 600, H = 190, padX = 18, padTop = 12, padBottom = 26;
  const peak = Math.max(max, ...rows.map((r) => r.totalG)) * 1.1;
  const plotH = H - padTop - padBottom;
  const y = (v) => padTop + plotH - (v / peak) * plotH;
  const barW = (W - padX * 2) / rows.length;

  // The healthy range drawn behind the bars, so "normal" is a place on the
  // chart rather than a number to remember.
  const band = `<rect class="band" x="${padX}" y="${y(max).toFixed(1)}"
      width="${W - padX * 2}" height="${(y(min) - y(max)).toFixed(1)}"/>`;

  const key = todayKey();
  const bars = rows.map((r, i) => {
    const h = Math.max(0, plotH - (y(r.totalG) - padTop));
    const x = padX + i * barW;
    const partial = r.date === key ? " partial" : "";
    return `<rect class="dbar${partial}" x="${(x + 1).toFixed(1)}" y="${y(r.totalG).toFixed(1)}"
             width="${Math.max(1, barW - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2">
             <title>${r.date}: ${Math.round(r.totalG)} ml</title></rect>`;
  }).join("");

  const first = rows[0].date.slice(5);
  const last = rows[rows.length - 1].date.slice(5);
  const axis =
    `<text class="axis" x="${padX}" y="${H - 6}">${first}</text>` +
    `<text class="axis" x="${W - padX}" y="${H - 6}" text-anchor="end">${last}</text>`;

  el.dailyChart.innerHTML = band + bars + axis;

  const done = completeDays();
  if (done.length >= 2) {
    const recent = done.slice(-7);
    const avg = recent.reduce((a, b) => a + b.totalG, 0) / recent.length;
    const yesterday = done[done.length - 1];
    const delta = avg > 0 ? ((yesterday.totalG - avg) / avg) * 100 : 0;
    const dir = delta > 5 ? "above" : delta < -5 ? "below" : "in line with";
    el.trendNote.textContent =
      `Last full day: ${Math.round(yesterday.totalG)} ml, ${dir} the ${recent.length}-day average of ${Math.round(avg)} ml.`;
  } else {
    el.trendNote.textContent = "Collecting days -- trends appear after a couple of full days.";
  }
}

function renderHealth() {
  const done = completeDays();
  const { min, max, kg } = expectedRange();

  if (done.length < 7) {
    el.healthBody.innerHTML =
      `<p class="hint">Building a baseline: ${done.length} of 7 full days recorded.
       Comparisons start once there is a week to compare against.</p>`;
    return;
  }

  // Compare the most recent finished day against the days before it, so the
  // day being judged isn't also propping up its own baseline.
  const latestDay = done[done.length - 1];
  const priorDays = done.slice(-15, -1);
  const baseline = priorDays.reduce((a, b) => a + b.totalG, 0) / priorDays.length;
  const deviation = baseline > 0 ? (latestDay.totalG - baseline) / baseline : 0;
  const pct = Math.abs(deviation) * 100;

  let state = "ok";
  let headline = "Drinking looks steady";
  let detail = `${latestDay.date} was ${Math.round(latestDay.totalG)} ml, close to the ${Math.round(baseline)} ml average of the previous ${priorDays.length} days.`;

  if (deviation >= 0.4) {
    state = "warn";
    headline = "Drinking noticeably more than usual";
    detail = `${latestDay.date} was ${Math.round(latestDay.totalG)} ml ג€” about ${Math.round(pct)}% above the ${Math.round(baseline)} ml baseline. A sustained increase is the pattern vets look at; a single hot day is not.`;
  } else if (deviation <= -0.4) {
    state = "warn";
    headline = "Drinking noticeably less than usual";
    detail = `${latestDay.date} was ${Math.round(latestDay.totalG)} ml ג€” about ${Math.round(pct)}% below the ${Math.round(baseline)} ml baseline. Check the bowl was reachable and full on that day before reading anything into it.`;
  }

  const inRange = latestDay.totalG >= min && latestDay.totalG <= max;

  el.healthBody.innerHTML = `
    <p class="health-headline" data-state="${state}">${headline}</p>
    <p class="health-detail">${detail}</p>
    <dl class="health-stats">
      <div><dt>Baseline</dt><dd>${Math.round(baseline)} ml/day</dd></div>
      <div><dt>Last full day</dt><dd>${Math.round(latestDay.totalG)} ml</dd></div>
      <div><dt>Typical for ${Math.round(kg)} kg</dt><dd>${Math.round(min)}-${Math.round(max)} ml</dd></div>
      <div><dt>In typical range</dt><dd>${inRange ? "yes" : "no"}</dd></div>
    </dl>`;
}

function exportCsv() {
  const header = "date,total_ml,drinks,evaporation_ml\n";
  const body = days.map((d) =>
    [d.date, Math.round(d.totalG), d.drinkCount, Math.round(d.evaporationG || 0)].join(",")
  ).join("\n");

  const blob = new Blob([header + body + "\n"], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `water-intake-${todayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

el.exportCsv.addEventListener("click", exportCsv);

onSnapshot(
  query(collection(db, "days"), orderBy("date", "desc"), limit(30)),
  (snap) => {
    days = snap.docs
      .map((d) => d.data())
      .filter((d) => d.date)
      .map((d) => ({
        date: d.date,
        totalG: d.totalG || 0,
        drinkCount: Number(d.drinkCount || 0),
        evaporationG: d.evaporationG || 0,
        hourly: Array.isArray(d.hourly) ? d.hourly.map(Number) : new Array(24).fill(0),
      }))
      .reverse(); // Firestore gives newest-first; charts read left-to-right

    renderHourly();
    renderHeatmap();
    renderDaily();
    renderHealth();
  },
  () => { /* best-effort */ }
);

let drinkRows = [];

onSnapshot(doc(db, "bowl", "latest"), (snap) => {
  if (!snap.exists()) return;
  latest = snap.data();
  renderToday();
});

onSnapshot(
  query(collection(db, "drinks"), orderBy("at", "desc"), limit(12)),
  (snap) => {
    drinkRows = snap.docs
      .map((d) => d.data())
      .filter((r) => r.at?.toDate)
      .map((r) => ({
        amountG: r.amountG || 0,
        durationS: Number(r.durationS || 0),
        at: r.at.toDate(),
      }));
    renderDrinks(drinkRows);
  },
  () => { /* best-effort, same as the other lists */ }
);

// Keep the relative timestamps and the day-pace verdict honest as time passes.
setInterval(() => {
  renderToday();
  renderDrinks(drinkRows);
}, 30000);

