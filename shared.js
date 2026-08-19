// Shared Firebase handle and formatting helpers.
//
// Both app.js (the live bowl) and stats.js (the analytics) need these. Two
// onSnapshot listeners on the same query are fine -- the Firestore SDK shares
// one underlying stream per query within a client, so this costs no extra
// reads.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const configured = !firebaseConfig.apiKey.startsWith("PASTE_");

export const db = configured ? getFirestore(initializeApp(firebaseConfig)) : null;

export function relativeTime(date) {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function clockTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
