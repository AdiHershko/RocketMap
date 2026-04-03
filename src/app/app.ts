import { Component, OnDestroy, AfterViewInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as L from 'leaflet';
import { AlertService, CityAlert } from './alert.service';
import { CityPolygonService } from './city-polygon.service';
import { CITY_COORDINATES } from './city-coordinates';
import { Subscription } from 'rxjs';

const ALERT_STYLE: L.PathOptions = {
  color: '#ff2200',
  fillColor: '#ff4400',
  fillOpacity: 0.4,
  weight: 2,
};

const AIRCRAFT_STYLE: L.PathOptions = {
  color: '#0055ff',
  fillColor: '#3377ff',
  fillOpacity: 0.4,
  weight: 2,
};

function styleForCat(cat: string): L.PathOptions {
  return cat === '2' ? AIRCRAFT_STYLE : ALERT_STYLE;
}

const SOURCE_IRAN: [number, number] = [32.4, 53.7]; // central Iran
const IRAN_FLIGHT_MS = 12 * 60 * 1000;             // 12 minutes
const EARLY_WARNING_TITLE = 'התראה מקדימה';

function centroid(coords: [number, number][]): [number, number] {
  const lat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return [lat, lng];
}

function interpolate(
  from: [number, number],
  to: [number, number],
  t: number,
): [number, number] {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
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

function makeDemo(
  cities: [string, string][],
  cat: string,
  title: string,
): Map<string, CityAlert> {
  const now = Date.now();
  return new Map(
    cities.map(([city], i) => [city, { cat, title, desc: '', timestamp: now + i * 4000 }]),
  );
}

interface IranTrajectory {
  startTime: number;
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

  private map!: L.Map;
  private cityLayers = new Map<string, L.Layer>();
  private iranTrajectory: IranTrajectory | null = null;
  private alertSub!: Subscription;

  // Iran scenario: batches of cities ordered east→west (decreasing longitude)
  // Each inner array is one wave, appearing together with a short delay between waves
  private static readonly IRAN_WAVES: string[][] = [
    ['קצרין', 'ירושלים', 'טבריה'],           // east (lon ~35.2–35.7)
    ['תל אביב - מרכז העיר', 'חיפה', 'באר שבע'], // center (lon ~34.8–35.0)
    ['אשדוד', 'נתניה', 'אשקלון'],             // west (lon ~34.6–34.9)
  ];

  private static readonly DEMO_SCENARIOS: Map<string, CityAlert>[] = [
    makeDemo(
      [['תל אביב - מרכז העיר', ''], ['רמת גן', ''], ['גבעתיים', ''], ['בני ברק', '']],
      '1', 'ירי רקטות וטילים',
    ),
    makeDemo(
      [['אשדוד', ''], ['אשקלון', ''], ['שדרות', ''], ['נתיבות', '']],
      '1', 'ירי רקטות וטילים',
    ),
    makeDemo(
      [['חיפה', ''], ['קריית ביאליק', ''], ['קריית מוצקין', ''], ['עכו', '']],
      '2', 'חדירת כלי טיס עוין',
    ),
  ];
  private demoIndex = 0;
  private demoRunning = false;

  constructor(
    private alertService: AlertService,
    private cityPolygonService: CityPolygonService,
  ) {}

  ngAfterViewInit(): void {
    this.initMap();
    this.alertSub = this.alertService.activeCities$.subscribe((cities) =>
      this.applyState(cities),
    );
    this.alertService.startPolling(3000);
  }

  ngOnDestroy(): void {
    this.alertService.stopPolling();
    this.alertSub?.unsubscribe();
    this.clearIranTrajectory();
  }

  protected triggerDemo(): void {
    if (this.demoRunning) return;
    this.isDemoActive.set(true);
    const total = App.DEMO_SCENARIOS.length + 1; // +1 for Iran scenario
    if (this.demoIndex % total === 0) {
      this.demoIndex++;
      this.runIranDemo();
    } else {
      const scenario = App.DEMO_SCENARIOS[(this.demoIndex % total) - 1];
      this.demoIndex++;
      this.runDemoScenario(scenario);
    }
  }

  private async runIranDemo(): Promise<void> {
    this.demoRunning = true;
    const accumulated = new Map<string, CityAlert>();

    for (const wave of App.IRAN_WAVES) {
      if (!this.demoRunning) break;
      const now = Date.now();
      for (const city of wave) {
        accumulated.set(city, { cat: '1', title: EARLY_WARNING_TITLE, desc: '', timestamp: now });
      }
      await this.applyState(new Map(accumulated));
      await new Promise((r) => setTimeout(r, 2500));
    }

    this.demoRunning = false;
  }

  protected clearDemo(): void {
    this.isDemoActive.set(false);
    this.demoRunning = false;
    this.demoIndex = 0;
    this.applyState(new Map());
  }

  private async runDemoScenario(scenario: Map<string, CityAlert>): Promise<void> {
    this.demoRunning = true;
    const accumulated = new Map<string, CityAlert>();

    for (const [city, alert] of scenario.entries()) {
      if (!this.demoRunning) break;
      accumulated.set(city, { ...alert, timestamp: Date.now() });
      await this.applyState(new Map(accumulated));
      await new Promise((r) => setTimeout(r, 2000));
    }

    this.demoRunning = false;
  }

  private initMap(): void {
    this.map = L.map('map', { center: [31.5, 34.8], zoom: 8 });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(this.map);

    this.map.createPane('trajectoryPane');
    this.map.getPane('trajectoryPane')!.style.zIndex = '450';
    this.map.getPane('trajectoryPane')!.style.pointerEvents = 'none';
  }

  private async applyState(cities: Map<string, CityAlert>): Promise<void> {
    for (const [city, layer] of this.cityLayers) {
      if (!cities.has(city)) {
        layer.remove();
        this.cityLayers.delete(city);
      }
    }

    const newEntries = [...cities.entries()].filter(([city]) => !this.cityLayers.has(city));

    await Promise.all(
      newEntries.map(async ([city, alert]) => {
        const layer = await this.buildLayer(city, alert);
        if (layer) {
          layer.addTo(this.map);
          this.cityLayers.set(city, layer);
        }
      }),
    );

    this.updateTrajectory(cities);

    this.hasAlerts.set(cities.size > 0);
    this.activeAlerts.set([...cities.entries()].map(([city, alert]) => ({ city, alert })));

    if (newEntries.length > 0 && this.cityLayers.size > 0) {
      const group = L.featureGroup([...this.cityLayers.values()]);
      this.map.fitBounds(group.getBounds().pad(0.3));
    }
  }

  private updateTrajectory(cities: Map<string, CityAlert>): void {
    const earlyWarnCoords = [...cities.entries()]
      .filter(([, a]) => a.title === EARLY_WARNING_TITLE)
      .map(([city]) => CITY_COORDINATES[city])
      .filter((c): c is [number, number] => !!c);

    if (earlyWarnCoords.length === 0) {
      this.clearIranTrajectory();
      return;
    }

    const target = centroid(earlyWarnCoords);
    const startTime = Math.min(
      ...[...cities.values()]
        .filter((a) => a.title === EARLY_WARNING_TITLE)
        .map((a) => a.timestamp),
    );

    // Trajectory already running — just update the target if new cities were added
    if (this.iranTrajectory) {
      if (this.iranTrajectory.startTime === startTime) {
        this.iranTrajectory.target = target;
        this.iranTrajectory.line.setLatLngs([SOURCE_IRAN, target]);
        return;
      }
      this.clearIranTrajectory();
    }

    this.startIranTrajectory(startTime, target);
  }

  private startIranTrajectory(startTime: number, target: [number, number]): void {
    const angle = bearing(SOURCE_IRAN, target);

    // Static dashed line from Iran to target
    const line = L.polyline([SOURCE_IRAN, target], {
      color: '#ff4400',
      weight: 3,
      dashArray: '10 7',
      opacity: 0.55,
      pane: 'trajectoryPane',
    }).addTo(this.map);

    // "Iran" label at origin
    const originIcon = L.divIcon({
      className: '',
      html: `<div style="
        background:#ff4400;color:#fff;font-size:10px;font-weight:bold;
        padding:2px 6px;border-radius:3px;white-space:nowrap;
        border:1px solid rgba(255,255,255,0.5);
      ">🇮🇷 Iran</div>`,
      iconAnchor: [0, 10],
    });
    const originLabel = L.marker(SOURCE_IRAN, {
      icon: originIcon,
      interactive: false,
    }).addTo(this.map);

    // Animated missile marker
    const initialPos = interpolate(SOURCE_IRAN, target, 0);
    const missileMarker = L.marker(initialPos, {
      icon: missileIcon(angle, Math.ceil(IRAN_FLIGHT_MS / 1000)),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(this.map);

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / IRAN_FLIGHT_MS, 1);
      const pos = interpolate(SOURCE_IRAN, this.iranTrajectory!.target, t);
      const secondsLeft = Math.max(0, Math.ceil((IRAN_FLIGHT_MS - elapsed) / 1000));
      const currentAngle = bearing(SOURCE_IRAN, this.iranTrajectory!.target);

      missileMarker.setLatLng(pos);
      missileMarker.setIcon(missileIcon(currentAngle, secondsLeft));

      if (t >= 1) this.clearIranTrajectory();
    };

    // Assign before tick() so the closure can read this.iranTrajectory.target
    this.iranTrajectory = {
      startTime, target, line, originLabel, missileMarker,
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

  private async buildLayer(city: string, alert: CityAlert): Promise<L.Layer | null> {
    const style = styleForCat(alert.cat);
    const popup = `<b>${city}</b><br>${alert.title}`;

    const feature = await this.cityPolygonService.fetchPolygon(city);
    if (feature) {
      return L.geoJSON(feature, { style: () => style }).bindPopup(popup);
    }

    const coords = CITY_COORDINATES[city];
    if (coords) {
      return L.circle(coords, { ...style, radius: 5000 }).bindPopup(popup);
    }

    return null;
  }
}
