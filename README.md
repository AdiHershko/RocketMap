# RocketMap

A real-time missile alert map for Israel, built with Angular and Leaflet. It polls the [Pikud HaOref (Home Front Command)](https://www.oref.org.il) API and displays active alert areas on an interactive map.

## Features

- **Live alert polling** — fetches the Pikud HaOref API every 3 seconds and accumulates active alerts per city
- **City boundary polygons** — highlights the actual municipal boundary of each alerted city (via OpenStreetMap / Nominatim), with a circle fallback for areas without polygon data
- **Alert types** — rockets/missiles shown in red, hostile aircraft in blue
- **Per-city state tracking** — a city stays highlighted until an explicit "האירוע הסתיים" (event ended) response removes it; an empty API response does not clear the map
- **Iran trajectory** — when a "התראה מקדימה" (early warning) is received, an animated missile marker travels from central Iran to the centroid of all alerted cities over a 12-minute countdown, matching the estimated ballistic flight time
- **Demo mode** — built-in scenarios to test all alert types and the Iran trajectory without waiting for a real event

## Data Sources

| Source | Purpose |
|--------|---------|
| [Pikud HaOref](https://www.oref.org.il/WarningMessages/alert/alerts.json) | Live missile alerts |
| [Nominatim / OpenStreetMap](https://nominatim.openstreetmap.org) | City boundary polygons |

## Getting Started

```bash
npm install
npm start
```

Then open `http://localhost:4200`.

> The dev server proxies both the Pikud HaOref API and Nominatim to avoid CORS issues. See `proxy.conf.json` for details.

## Alert Categories

| Category | Hebrew | Color |
|----------|--------|-------|
| Rockets & missiles | ירי רקטות וטילים | Red |
| Hostile aircraft | חדירת כלי טיס עוין | Blue |
| Early warning (Iran) | התראה מקדימה | Red + trajectory |

## Tech Stack

- [Angular 21](https://angular.dev) — standalone components, signals
- [Leaflet](https://leafletjs.com) — interactive map
- [OpenStreetMap](https://www.openstreetmap.org) — map tiles
- [Nominatim](https://nominatim.openstreetmap.org) — city boundary polygons

## Note

This project is intended for informational and educational purposes. In a real emergency, always follow official Pikud HaOref instructions.
