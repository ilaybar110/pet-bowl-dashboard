# Pet Bowl Dashboard

Live web dashboard for a WiFi-connected dog water bowl scale.

An ESP32 with an HX711 load-cell amplifier sits under the bowl, measures the
water weight, and writes readings to Firestore. This page reads them back in
real time and shows the current level, whether a refill is needed, and recent
history. When the bowl runs low the ESP32 also sends a push notification via
[ntfy.sh](https://ntfy.sh).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `app.js` | Firestore realtime subscription + chart rendering |
| `style.css` | Styling, light/dark aware |
| `firebase-config.js` | Firebase project identifiers |

## About the Firebase config

The `apiKey` and `projectId` in `firebase-config.js` are public by design --
every Firebase web app ships them to the browser. They identify the project;
they don't grant access. Access is controlled by Firestore security rules,
which allow anyone to *read* the bowl data but only the ESP32's dedicated
device account to *write* it.

## Running locally

The page uses ES modules, so it needs to be served over HTTP rather than
opened as a `file://` URL:

```
python -m http.server 8000
```

Then open <http://localhost:8000>.
