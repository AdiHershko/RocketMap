import { Component, OnDestroy, AfterViewInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as L from 'leaflet';
import { AlertService, CityAlert, HistoryEntry } from './alert.service';
import { CITY_COORDINATES } from './city-coordinates';
import { Subscription } from 'rxjs';

// Cat numbers from Oref
const CAT_EARLY_WARNING = '5';
const CAT_AIRCRAFT      = '2';

const EARLY_WARNING_TITLE = 'בדקות הקרובות צפויות להתקבל התראות באזורכם';
const ROCKETS_TITLE       = 'ירי רקטות וטילים';
const AIRCRAFT_TITLE      = 'חדירת כלי טיס עוין';
const ALL_CLEAR_TITLE     = 'האירוע הסתיים';

function styleForAlert(alert: CityAlert): L.PathOptions {
  const base = { fillOpacity: 0.4, weight: 2 };
  if (alert.clearing)                return { ...base, color: '#00aa44', fillColor: '#00cc55' }; // green
  if (alert.cat === CAT_EARLY_WARNING) return { ...base, color: '#cc6600', fillColor: '#ff8800' }; // orange
  if (alert.cat === CAT_AIRCRAFT)    return { ...base, color: '#0055ff', fillColor: '#3377ff' }; // blue
  return                                    { ...base, color: '#cc0000', fillColor: '#ff2200' }; // red
}

// Origin sources
interface Origin {
  label: string;
  flag: string;
  coords: [number, number];
  color: string;
  flightMsDemo: number;
  flightMsReal: number;
}

const ORIGINS: Record<string, Origin> = {
  iran:    { label: 'Iran',    flag: '🇮🇷', coords: [32.4, 53.7],  color: '#ff4400', flightMsDemo: 60000,  flightMsReal: 6.5 * 60000 },
  lebanon: { label: 'Lebanon', flag: '🇱🇧', coords: [33.8, 35.6],  color: '#ff4400', flightMsDemo: 15000,  flightMsReal: 1.5 * 60000 },
  gaza:    { label: 'Gaza',    flag: '🟢',  coords: [31.4, 34.3],  color: '#ff4400', flightMsDemo: 12000,  flightMsReal: 60000        },
  syria:   { label: 'Syria',   flag: '🇸🇾', coords: [33.5, 36.8],  color: '#ff4400', flightMsDemo: 15000,  flightMsReal: 1.5 * 60000 },
  yemen:   { label: 'Yemen',   flag: '🇾🇪', coords: [15.5, 44.0],  color: '#ff4400', flightMsDemo: 60000,  flightMsReal: 8 * 60000    },
  westbank:{ label: 'West Bank',flag: '⚫', coords: [31.9, 35.2],  color: '#ff4400', flightMsDemo: 10000,  flightMsReal: 45000        },
};

/**
 * Detect origin from the set of alerted city coordinates.
 * - Early warning (cat 5) → Iran (only Iran sends pre-alerts)
 * - Wide spread (stddev lat > 0.6°) + many cities → Iran
 * - North (centroid lat > 32.8°) + west of 35.8° → Lebanon
 * - North + east of 35.8° → Syria/Golan
 * - South (centroid lat < 31.5°) → Gaza
 * - Far south (centroid lat < 30.5°) → Yemen
 * - Central-east (lng > 35.0°) → West Bank
 * - Default → Lebanon
 */
function detectOrigin(
  cities: Map<string, CityAlert>,
  coords: Map<string, [number, number]>,
): string {
  const pts = [...cities.keys()]
    .map((c) => coords.get(c))
    .filter((c): c is [number, number] => !!c);

  if (pts.length === 0) return 'lebanon';

  const avgLat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const avgLng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const stdLat = Math.sqrt(pts.reduce((s, p) => s + (p[0] - avgLat) ** 2, 0) / pts.length);

  const hasEarlyWarning = [...cities.values()].some((a) => a.cat === CAT_EARLY_WARNING);

  // Yemen: far south, always comes with early warning
  if (avgLat < 31.0) return 'yemen';
  // Iran: early warning + central/wide spread
  if (hasEarlyWarning) return 'iran';
  if (pts.length >= 10 && stdLat > 0.6) return 'iran';
  if (avgLat < 31.5) return 'gaza';
  if (avgLat > 32.8 && avgLng > 35.8) return 'syria';
  if (avgLat > 32.8) return 'lebanon';
  if (avgLng > 35.0 && avgLat < 32.5) return 'westbank';
  return 'lebanon';
}

function centroid(coords: [number, number][]): [number, number] {
  const lat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return [lat, lng];
}

// Convert lat/lng (degrees) to a unit Cartesian vector
function toCartesian(lat: number, lng: number): [number, number, number] {
  const φ = (lat * Math.PI) / 180;
  const λ = (lng * Math.PI) / 180;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

// Convert a unit Cartesian vector back to [lat, lng] degrees
function fromCartesian(v: [number, number, number]): [number, number] {
  return [
    (Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180) / Math.PI,
    (Math.atan2(v[1], v[0]) * 180) / Math.PI,
  ];
}

// Spherical Linear Interpolation — single point at fraction t along great circle
function slerp(
  from: [number, number],
  to: [number, number],
  t: number,
): [number, number] {
  const a = toCartesian(from[0], from[1]);
  const b = toCartesian(to[0], to[1]);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-10) return from;
  const sinOmega = Math.sin(omega);
  const f1 = Math.sin((1 - t) * omega) / sinOmega;
  const f2 = Math.sin(t * omega) / sinOmega;
  return fromCartesian([f1 * a[0] + f2 * b[0], f1 * a[1] + f2 * b[1], f1 * a[2] + f2 * b[2]]);
}

// Sample the great circle into numPoints segments for the polyline
function greatCirclePath(
  from: [number, number],
  to: [number, number],
  numPoints = 120,
): [number, number][] {
  return Array.from({ length: numPoints + 1 }, (_, i) => slerp(from, to, i / numPoints));
}

function bearing(from: [number, number], to: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLon = toRad(to[1] - from[1]);
  const lat1 = toRad(from[0]);
  const lat2 = toRad(to[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function missileIcon(angle: number, secondsLeft: number): L.DivIcon {
  const mins = Math.floor(secondsLeft / 60)
    .toString()
    .padStart(2, '0');
  const secs = (secondsLeft % 60).toString().padStart(2, '0');
  return L.divIcon({
    className: '',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
             style="overflow:visible;display:block;filter:drop-shadow(0 0 3px rgba(255,80,0,0.9))">
          <polygon points="12,2 22,22 12,17 2,22"
            fill="#ff4400" stroke="white" stroke-width="1.5"
            transform="rotate(${angle},12,12)"/>
        </svg>
        <div style="
          background:rgba(0,0,0,0.75);color:#ff9900;font-size:11px;
          font-weight:bold;font-family:monospace;padding:1px 5px;
          border-radius:3px;white-space:nowrap;border:1px solid #ff4400;
        ">${mins}:${secs}</div>
      </div>`,
    iconSize: [40, 48],
    iconAnchor: [14, 14],
  });
}


interface IranTrajectory {
  startTime: number;
  originKey: string;
  target: [number, number];
  line: L.Polyline;
  originLabel: L.Marker;
  missileMarker: L.Marker;
  intervalId: ReturnType<typeof setInterval>;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements AfterViewInit, OnDestroy {
  protected readonly activeAlerts = signal<{ city: string; alert: CityAlert }[]>([]);
  protected readonly hasAlerts = signal(false);
  protected readonly isDemoActive = signal(false);
  protected readonly sidebarCollapsed = signal(window.innerWidth < 768);
  protected readonly activeTab = signal<'live' | 'history'>('live');
  protected readonly alertHistory = signal<HistoryEntry[]>([]);

  protected toggleSidebar(): void {
    this.sidebarCollapsed.set(!this.sidebarCollapsed());
    setTimeout(() => this.map?.invalidateSize(), 260);
  }

  private historySub!: Subscription;

  protected categoryLabel(title: string): string {
    if (title.includes('הסתיים'))          return 'All Clear';
    if (title.includes('בדקות הקרובות')) return 'Early Warning';
    if (title.includes('כלי טיס'))        return 'Aircraft';
    if (title.includes('טילים'))           return 'Rockets';
    return 'Alert';
  }

  protected formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  private map!: L.Map;
  private cityLayers = new Map<string, { layer: L.Layer; title: string; cat: string }>();
  private iranTrajectory: IranTrajectory | null = null;
  private aircraftLayers: L.Layer[] = [];
  private alertSub!: Subscription;

  // Iran scenario: east→west band across central Israel (~32.08° ± 7km lat)
  // Longitudes: 34.96 → 34.88 → 34.78  (east to west, ~18km total spread)
  // N-S spread: 32.116 – 32.053 = ~7km  ✓
  private static readonly IRAN_WAVES: string[][] = [
    ['ראש העין', 'כפר קאסם', 'אלעד'],                   // east  (lon ~34.95–34.98)
    ['פתח תקווה', 'קריית אונו', 'גבעת שמואל'],           // center (lon ~34.86–34.89)
    ['בני ברק', 'רמת גן', 'גבעתיים', 'תל אביב - מרכז העיר'], // west (lon ~34.78–34.83)
  ];

  // Lebanon rockets: north Israel, no early warning, east→west/north→south
  private static readonly LEBANON_WAVES: string[][] = [
    ['קריית שמונה', 'מטולה', 'שלומי'],
    ['נהריה', 'כרמיאל'],
    ['עכו', 'חיפה'],
  ];

  // Lebanon hostile aircraft: north→south flight path
  private static readonly AIRCRAFT_WAVES: string[][] = [
    ['מטולה', 'קריית שמונה'],
    ['שלומי', 'נהריה'],
    ['עכו', 'קריית ביאליק', 'חיפה'],
  ];

  // Yemen/Houthi: long-range ballistic, far south (Eilat/Negev), always has early warning
  private static readonly YEMEN_WAVES: string[][] = [
    ['אילת', 'מצפה רמון'],
    ['ירוחם', 'דימונה'],
    ['ערד', 'באר שבע'],
  ];

  protected demoRunning = false;

  constructor(
    private alertService: AlertService,
  ) {}

  ngAfterViewInit(): void {
    this.initMap();
    this.alertSub = this.alertService.activeCities$.subscribe((cities) =>
      this.applyState(cities),
    );
    this.alertService.startPolling(3000);
    this.historySub = this.alertService.history$.subscribe((h) => this.alertHistory.set(h));
  }

  ngOnDestroy(): void {
    this.alertService.stopPolling();
    this.alertSub?.unsubscribe();
    this.historySub?.unsubscribe();
    this.clearIranTrajectory();
    this.clearAircraftTrajectory();
  }

  protected startLebanonRocketsDemo(): void { this.runLebanonDemo(); }
  protected startIranRocketsDemo(): void { this.runIranDemo(); }
  protected startAircraftDemo(): void { this.runAircraftDemo(); }
  protected startYemenDemo(): void { this.runYemenDemo(); }

  private async runIranDemo(): Promise<void> {
    if (this.demoRunning) return;
    this.demoRunning = true;
    this.isDemoActive.set(true);
    const accumulated = new Map<string, CityAlert>();

    const demoStart = Date.now();

    // Phase 1: Early warning waves east→west (~6s total)
    for (const wave of App.IRAN_WAVES) {
      if (!this.demoRunning) { this.demoRunning = false; return; }
      const now = Date.now();
      for (const city of wave) {
        accumulated.set(city, { cat: CAT_EARLY_WARNING, title: EARLY_WARNING_TITLE, desc: '', timestamp: now });
      }
      this.applyState(new Map(accumulated));
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!this.demoRunning) { this.demoRunning = false; return; }

    // Wait until 20s from demo start, then upgrade to rocket alert
    await new Promise((r) => setTimeout(r, Math.max(0, 20000 - (Date.now() - demoStart))));
    if (!this.demoRunning) { this.demoRunning = false; return; }

    // Phase 2: Rocket alert (trajectory stays visible)
    const rocketTime = Date.now();
    for (const city of accumulated.keys()) {
      accumulated.set(city, { cat: '1', title: ROCKETS_TITLE, desc: '', timestamp: rocketTime });
    }
    this.applyState(new Map(accumulated));

    // Wait 40s then clear (missile arrives at 60s from start)
    await new Promise((r) => setTimeout(r, 40000));
    if (!this.demoRunning) { this.demoRunning = false; return; }

    // Phase 3: Clear
    await this.clearCities(accumulated);
    this.demoRunning = false;
  }

  private async runLebanonDemo(): Promise<void> {
    if (this.demoRunning) return;
    this.demoRunning = true;
    this.isDemoActive.set(true);
    const accumulated = new Map<string, CityAlert>();

    // Rocket alerts wave by wave from north (no early warning)
    for (const wave of App.LEBANON_WAVES) {
      if (!this.demoRunning) { this.demoRunning = false; return; }
      const now = Date.now();
      for (const city of wave) {
        accumulated.set(city, { cat: '1', title: ROCKETS_TITLE, desc: '', timestamp: now });
      }
      this.applyState(new Map(accumulated));
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!this.demoRunning) { this.demoRunning = false; return; }
    await new Promise((r) => setTimeout(r, 3000));

    await this.clearCities(accumulated);
    this.demoRunning = false;
  }

  private async runAircraftDemo(): Promise<void> {
    if (this.demoRunning) return;
    this.demoRunning = true;
    this.isDemoActive.set(true);
    const accumulated = new Map<string, CityAlert>();

    for (const wave of App.AIRCRAFT_WAVES) {
      if (!this.demoRunning) { this.demoRunning = false; return; }
      const now = Date.now();
      for (const city of wave) {
        accumulated.set(city, { cat: '2', title: AIRCRAFT_TITLE, desc: '', timestamp: now });
      }
      this.applyState(new Map(accumulated));
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (!this.demoRunning) { this.demoRunning = false; return; }
    await new Promise((r) => setTimeout(r, 4000));
    await this.clearCities(accumulated);
    this.demoRunning = false;
  }

  private async runYemenDemo(): Promise<void> {
    if (this.demoRunning) return;
    this.demoRunning = true;
    this.isDemoActive.set(true);
    const accumulated = new Map<string, CityAlert>();

    const demoStart = Date.now();

    // Phase 1: Early warning waves south→north
    for (const wave of App.YEMEN_WAVES) {
      if (!this.demoRunning) { this.demoRunning = false; return; }
      const now = Date.now();
      for (const city of wave) {
        accumulated.set(city, { cat: CAT_EARLY_WARNING, title: EARLY_WARNING_TITLE, desc: '', timestamp: now });
      }
      this.applyState(new Map(accumulated));
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!this.demoRunning) { this.demoRunning = false; return; }

    // Wait until 20s then upgrade to rocket alert
    await new Promise((r) => setTimeout(r, Math.max(0, 20000 - (Date.now() - demoStart))));
    if (!this.demoRunning) { this.demoRunning = false; return; }

    // Phase 2: Rocket alert
    const rocketTime = Date.now();
    for (const city of accumulated.keys()) {
      accumulated.set(city, { cat: '1', title: ROCKETS_TITLE, desc: '', timestamp: rocketTime });
    }
    this.applyState(new Map(accumulated));

    await new Promise((r) => setTimeout(r, 40000));
    if (!this.demoRunning) { this.demoRunning = false; return; }

    // Phase 3: Clear
    await this.clearCities(accumulated);
    this.demoRunning = false;
  }

  private async clearCities(cities: Map<string, CityAlert>): Promise<void> {
    const clearMap = new Map<string, CityAlert>();
    for (const [city, alert] of cities) {
      clearMap.set(city, { ...alert, title: ALL_CLEAR_TITLE, clearing: true });
    }
    this.applyState(clearMap);
    await new Promise((r) => setTimeout(r, 2500));
    this.applyState(new Map());
  }

  protected clearDemo(): void {
    this.isDemoActive.set(false);
    this.demoRunning = false;
    this.applyState(new Map());
  }


  private initMap(): void {
    this.map = L.map('map', { center: [31.5, 34.8], zoom: 8 });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(this.map);

    this.map.createPane('trajectoryPane');
    this.map.getPane('trajectoryPane')!.style.zIndex = '450';
    this.map.getPane('trajectoryPane')!.style.pointerEvents = 'none';
  }

  private applyState(cities: Map<string, CityAlert>): void {
    for (const [city, entry] of this.cityLayers) {
      const updated = cities.get(city);
      // Remove if gone, clearing, or alert type changed (title/cat)
      if (!updated || updated.clearing || updated.title !== entry.title || updated.cat !== entry.cat) {
        entry.layer.remove();
        this.cityLayers.delete(city);
      }
    }

    const newEntries = [...cities.entries()].filter(([city]) => !this.cityLayers.has(city));

    for (const [city, alert] of newEntries) {
      const layer = this.buildLayer(city, alert);
      if (layer) {
        layer.addTo(this.map);
        this.cityLayers.set(city, { layer, title: alert.title, cat: alert.cat });
      }
    }

    this.updateTrajectory(cities);

    this.hasAlerts.set(cities.size > 0);
    this.activeAlerts.set([...cities.entries()].map(([city, alert]) => ({ city, alert })));

    if (newEntries.length > 0 && this.cityLayers.size > 0) {
      const group = L.featureGroup([...this.cityLayers.values()].map((e) => e.layer));
      this.map.fitBounds(group.getBounds().pad(0.3));
    }
  }

  private updateTrajectory(cities: Map<string, CityAlert>): void {
    this.updateAircraftTrajectory(cities);

    const activeCities = [...cities.entries()].filter(([, a]) => !a.clearing && a.cat !== CAT_AIRCRAFT);
    if (activeCities.length === 0) {
      this.clearIranTrajectory();
      return;
    }

    const coordsMap = new Map(
      activeCities.map(([city]) => [city, CITY_COORDINATES[city]]).filter(([, c]) => !!c) as [string, [number, number]][]
    );

    const earlyWarnCities = activeCities.filter(([, a]) => a.cat === CAT_EARLY_WARNING);
    const sourceCities = earlyWarnCities.length > 0 ? earlyWarnCities : activeCities;
    const sourceCoords = sourceCities
      .map(([city]) => CITY_COORDINATES[city])
      .filter((c): c is [number, number] => !!c);

    if (sourceCoords.length === 0) {
      if (this.iranTrajectory) {
        const hasActive = [...cities.values()].some((a) => !a.clearing);
        if (!hasActive) this.clearIranTrajectory();
      }
      return;
    }

    const target = centroid(sourceCoords);
    const startTime = Math.min(...sourceCities.map(([, a]) => a.timestamp));

    // If trajectory already running, keep existing origin (don't re-detect on early warning → rocket transition)
    if (this.iranTrajectory) {
      this.iranTrajectory.target = target;
      this.iranTrajectory.line.setLatLngs(greatCirclePath(ORIGINS[this.iranTrajectory.originKey].coords, target));
      return;
    }

    const originKey = detectOrigin(cities, coordsMap);
    if (originKey === 'lebanon') return;
    this.startMissileTrajectory(originKey, startTime, target);
  }

  private startMissileTrajectory(originKey: string, startTime: number, target: [number, number]): void {
    const origin = ORIGINS[originKey];
    const flightMs = this.isDemoActive() ? origin.flightMsDemo : origin.flightMsReal;
    const angle = bearing(origin.coords, target);

    const line = L.polyline(greatCirclePath(origin.coords, target), {
      color: origin.color,
      weight: 3,
      dashArray: '10 7',
      opacity: 0.55,
      pane: 'trajectoryPane',
    }).addTo(this.map);

    const originIcon = L.divIcon({
      className: '',
      html: `<div style="
        background:${origin.color};color:#fff;font-size:10px;font-weight:bold;
        padding:2px 6px;border-radius:3px;white-space:nowrap;
        border:1px solid rgba(255,255,255,0.5);
      ">${origin.flag} ${origin.label}</div>`,
      iconAnchor: [0, 10],
    });
    const originLabel = L.marker(origin.coords, { icon: originIcon, interactive: false }).addTo(this.map);

    const initialPos = slerp(origin.coords, target, 0);
    const missileMarker = L.marker(initialPos, {
      icon: missileIcon(angle, Math.ceil(flightMs / 1000)),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(this.map);

    const tick = () => {
      if (!this.iranTrajectory) return;
      const traj = this.iranTrajectory;
      const src = ORIGINS[traj.originKey].coords;
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / flightMs, 1);
      const pos = slerp(src, traj.target, t);
      const secondsLeft = Math.max(0, Math.ceil((flightMs - elapsed) / 1000));
      missileMarker.setLatLng(pos);
      missileMarker.setIcon(missileIcon(bearing(src, traj.target), secondsLeft));
      if (t >= 1) this.clearIranTrajectory();
    };

    this.iranTrajectory = {
      originKey, startTime, target, line, originLabel, missileMarker,
      intervalId: null as unknown as ReturnType<typeof setInterval>,
    };
    tick();
    this.iranTrajectory.intervalId = setInterval(tick, 1000);
  }

  private clearIranTrajectory(): void {
    if (!this.iranTrajectory) return;
    clearInterval(this.iranTrajectory.intervalId);
    this.iranTrajectory.line.remove();
    this.iranTrajectory.originLabel.remove();
    this.iranTrajectory.missileMarker.remove();
    this.iranTrajectory = null;
  }

  private updateAircraftTrajectory(cities: Map<string, CityAlert>): void {
    this.clearAircraftTrajectory();

    // Collect aircraft-alerted cities sorted by timestamp
    const points = [...cities.entries()]
      .filter(([, a]) => a.cat === '2' && !a.clearing)
      .sort(([, a], [, b]) => a.timestamp - b.timestamp)
      .map(([city]) => CITY_COORDINATES[city])
      .filter((c): c is [number, number] => !!c);

    if (points.length < 2) return;

    const line = L.polyline(points, {
      color: '#3377ff',
      weight: 4,
      dashArray: '10 7',
      opacity: 1,
      pane: 'trajectoryPane',
    });
    line.addTo(this.map);
    this.aircraftLayers.push(line);

    // Arrowhead at the leading city
    const tip = points[points.length - 1];
    const prev = points[points.length - 2];
    const angle = bearing(prev, tip);

    const arrowIcon = L.divIcon({
      className: '',
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
               style="overflow:visible;display:block;filter:drop-shadow(0 0 3px rgba(0,100,255,0.8))">
               <polygon points="12,2 22,22 12,17 2,22"
                 fill="#3377ff" stroke="white" stroke-width="1.5"
                 transform="rotate(${angle},12,12)"/>
             </svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const arrow = L.marker(tip, { icon: arrowIcon, interactive: false });
    arrow.addTo(this.map);
    this.aircraftLayers.push(arrow);
  }

  private clearAircraftTrajectory(): void {
    for (const layer of this.aircraftLayers) layer.remove();
    this.aircraftLayers = [];
  }

  private buildLayer(city: string, alert: CityAlert): L.Layer | null {
    const coords = CITY_COORDINATES[city];
    if (!coords) return null;

    const style = styleForAlert(alert);
    const popup = `<b>${city}</b><br>${alert.title}`;

    const marker = L.circleMarker(coords, {
      ...style,
      radius: 10,
    }).bindPopup(popup);

    marker.on('mouseover', () => marker.setStyle({ fillOpacity: 0.7, weight: 3 }));
    marker.on('mouseout', () => marker.setStyle({ fillOpacity: style.fillOpacity!, weight: style.weight! }));

    return marker;
  }
}
