import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../environments/environment';

export interface CityAlert {
  cat: string;
  title: string;
  desc: string;
  timestamp: number;
  clearing?: boolean;
  trace?: boolean;
}

export interface HistoryEntry {
  id: string;
  cat: string;
  title: string;
  cities: string[];
  timestamp: number;
}

const ALL_CLEAR_TITLE = 'האירוע הסתיים';
const CLEAR_DISPLAY_MS       = 60 * 1000;        // 60s green clearing phase
const TRACE_DISPLAY_MS       = 5 * 60 * 1000;    // 5min faded post-alert trace (live session)
const CLEAR_TRACE_DISPLAY_MS = 10 * 60 * 1000;   // 10min green trace after all-clear (history bootstrap)
const ALERT_LOOKBACK_MS      = 30 * 60 * 1000;   // 30min lookback for active alerts with no all-clear

/**
 * Parse an Israel-local date string ("DD/MM/YYYY HH:MM:SS") into a UTC timestamp.
 * Uses the browser's Intl API to handle DST correctly.
 */
function parseIsraelDate(dateStr: string): number | null {
  // Support both "DD/MM/YYYY HH:MM:SS" and "YYYY-MM-DD HH:MM:SS"
  let dd: string, mm: string, yyyy: string, hh: string, min: string, ss: string;
  const m1 = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  const m2 = dateStr.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m1) { [, dd, mm, yyyy, hh, min, ss] = m1; }
  else if (m2) { [, yyyy, mm, dd, hh, min, ss] = m2; }
  else return null;
  // Determine current Israel UTC offset via Intl (handles DST)
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const israelNowMs = Date.UTC(+parts['year'], +parts['month'] - 1, +parts['day'], +parts['hour'], +parts['minute'], +parts['second']);
  const offsetMs = israelNowMs - now.getTime();
  return Date.UTC(+yyyy, +mm - 1, +dd, +hh, +min, +ss) - offsetMs;
}

/**
 * Oref alert IDs are Windows FILETIME values (100-nanosecond ticks since 1601-01-01).
 * Convert to Unix ms so we know when the alert was actually created on the server.
 */
function alertIdToMs(id: string): number | null {
  const filetime = parseInt(id, 10);
  if (!filetime) return null;
  const unixMs = filetime / 10000 - 11644473600000;
  const now = Date.now();
  // Sanity: must be within the last 30 minutes and not in the future
  if (unixMs < now - 30 * 60 * 1000 || unixMs > now + 5000) return null;
  return unixMs;
}

export function typeFromTitle(title: string, desc: string): 'all-clear' | 'early-warning' | 'aircraft' | 'rockets' {
  if (title.includes('הסתיים') || desc?.includes('הסתיים') || desc?.includes('יכולים לצאת')) return 'all-clear';
  if (title.includes('בדקות הקרובות') || desc?.includes('בדקות הקרובות')) return 'early-warning';
  if (title.includes('כלי טיס')) return 'aircraft';
  return 'rockets';
}

@Injectable({ providedIn: 'root' })
export class AlertService implements OnDestroy {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private state = new Map<string, CityAlert>();
  private lastAlertId = '';
  readonly activeCities$ = new BehaviorSubject<Map<string, CityAlert>>(new Map());
  readonly history$ = new BehaviorSubject<HistoryEntry[]>([]);

  startPolling(intervalMs = 3000): void {
    Promise.all([this.bootstrapFromCache(), this.bootstrapFromHistory()])
      .then(() => this.fetchAlerts());
    this.intervalId = setInterval(() => this.fetchAlerts(), intervalMs);
  }

  stopPolling(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private async bootstrapFromCache(): Promise<void> {
    try {
      const res = await fetch(`${environment.orefBase}/recent-alert`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as { id: string; cat: string; title: string; data: string[]; desc: string; _cachedAt: number } | null;
      if (!data?.data?.length) return;

      const age = Date.now() - data._cachedAt;
      if (age < 0 || age > ALERT_LOOKBACK_MS) return;

      const type = typeFromTitle(data.title, data.desc);
      if (type === 'all-clear') return;

      const effectiveCat = type === 'early-warning' ? '5' : type === 'aircraft' ? '2' : '1';
      let changed = false;

      for (const city of data.data) {
        if (this.state.has(city)) continue;
        this.state.set(city, {
          cat: effectiveCat,
          title: data.title,
          desc: data.desc,
          timestamp: data._cachedAt,
        });
        changed = true;
      }

      if (changed) this.activeCities$.next(new Map(this.state));
    } catch {
      // ignore
    }
  }

  private async bootstrapFromHistory(): Promise<void> {
    try {
      const res = await fetch(
        `${environment.orefBase}/WarningMessages/alert/History/AlertsHistory.json`,
        { cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.oref.org.il/' } },
      );
      if (!res.ok) return;
      const text = (await res.text()).trim().replace(/^\uFEFF/, '');
      if (!text) return;

      const raw = JSON.parse(text);
      const entries: Array<{ alertDate: string; title: string; data: string; category: string }> =
        Array.isArray(raw) ? raw : Object.values(raw);
      const now = Date.now();

      // Build a map of city → most recent history entry within the lookback window
      const cityLatest = new Map<string, { ts: number; type: string; cat: string; title: string }>();
      for (const entry of entries) {
        const ts = parseIsraelDate(entry.alertDate);
        if (!ts || ts < now - ALERT_LOOKBACK_MS || ts > now) continue;
        const type = typeFromTitle(entry.title, '');
        for (const city of entry.data.split(/\r?\n/).map((c) => c.trim()).filter(Boolean)) {
          const prev = cityLatest.get(city);
          if (!prev || ts > prev.ts) {
            cityLatest.set(city, { ts, type, cat: entry.category ?? '1', title: entry.title });
          }
        }
      }

      let changed = false;
      for (const [city, info] of cityLatest) {
        const existing = this.state.get(city);
        const age = now - info.ts;

        if (info.type === 'all-clear') {
          if (age > CLEAR_TRACE_DISPLAY_MS) continue;
          // Don't override if already in clearing/trace state
          if (existing?.clearing || existing?.trace) continue;
          // Don't override if existing state is more recent (e.g. a new alert after this all-clear)
          if (existing && existing.timestamp > info.ts) continue;
          // All-clear was the last event → faded green trace (overrides cache-bootstrapped active)
          this.state.set(city, { cat: info.cat, title: ALL_CLEAR_TITLE, desc: '', timestamp: info.ts, trace: true });
          setTimeout(() => this.removeTraceCity(city), CLEAR_TRACE_DISPLAY_MS - age);
        } else {
          if (existing) continue; // don't overwrite any existing state with an active entry
          // No all-clear seen → show as active alert, no auto-expire
          this.state.set(city, { cat: info.cat, title: info.title, desc: '', timestamp: info.ts });
        }
        changed = true;
      }

      if (changed) this.activeCities$.next(new Map(this.state));

      // Seed history tab with entries from AlertsHistory
      const existingIds = new Set(this.history$.value.map((h) => h.id));
      const historyEntries: HistoryEntry[] = entries
        .map((entry) => {
          const ts = parseIsraelDate(entry.alertDate);
          if (!ts) return null;
          const cities = entry.data.split(/\r?\n/).map((c) => c.trim()).filter(Boolean);
          if (!cities.length) return null;
          const cat = String(entry.category ?? '1');
          return { id: entry.alertDate, cat, title: entry.title, cities, timestamp: ts } satisfies HistoryEntry;
        })
        .filter((e): e is HistoryEntry => !!e && !existingIds.has(e.id))
        .sort((a, b) => b.timestamp - a.timestamp);

      if (historyEntries.length > 0) {
        this.history$.next([...historyEntries, ...this.history$.value].slice(0, 200));
      }
    } catch {
      // ignore
    }
  }

  private async fetchAlerts(): Promise<void> {
    try {
      const res = await fetch(`${environment.orefBase}/WarningMessages/alert/alerts.json`, {
        cache: 'no-store',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Referer: 'https://www.oref.org.il/',
        },
      });

      if (!res.ok) return;

      const text = (await res.text()).trim().replace(/^\uFEFF/, '');
      if (!text) return;

      const data = JSON.parse(text) as {
        id: string;
        cat: string;
        title: string;
        data: string[];
        desc: string;
      };

      if (!data.data?.length) return;

      let changed = false;

      const type = typeFromTitle(data.title, data.desc);
      const isAllClear     = type === 'all-clear';
      const isEarlyWarning = type === 'early-warning';
      const effectiveCat   = isEarlyWarning ? '5' : type === 'aircraft' ? '2' : '1';
      const effectiveTitle = data.title;

      if (isAllClear) {
        for (const city of data.data) {
          const existing = this.state.get(city);
          if (existing && !existing.clearing && !existing.trace) {
            this.state.set(city, { ...existing, title: ALL_CLEAR_TITLE, clearing: true });
            changed = true;
            setTimeout(() => this.transitionToTrace(city), CLEAR_DISPLAY_MS);
          }
        }
      } else {
        if (type === 'rockets') {
          for (const [city, alert] of this.state) {
            if (typeFromTitle(alert.title, alert.desc) === 'early-warning') {
              this.state.delete(city);
              changed = true;
            }
          }
        }
        const alertStart = alertIdToMs(data.id) ?? Date.now();
        for (const city of data.data) {
          const existing = this.state.get(city);
          this.state.set(city, {
            cat: effectiveCat,
            title: effectiveTitle,
            desc: data.desc,
            timestamp: existing ? existing.timestamp : alertStart,
          });
          changed = true;
        }
      }

      if (changed) {
        this.activeCities$.next(new Map(this.state));
      }

      if (data.id && data.id !== this.lastAlertId) {
        this.lastAlertId = data.id;
        const entry: HistoryEntry = {
          id: data.id,
          cat: effectiveCat,
          title: effectiveTitle,
          cities: data.data,
          timestamp: Date.now(),
        };
        this.history$.next([entry, ...this.history$.value].slice(0, 200));
      }
    } catch {
      // ignore parse/network errors
    }
  }

  private transitionToTrace(city: string): void {
    const current = this.state.get(city);
    if (!current?.clearing) return;
    this.state.set(city, { ...current, clearing: false, trace: true });
    this.activeCities$.next(new Map(this.state));
    setTimeout(() => this.removeTraceCity(city), TRACE_DISPLAY_MS);
  }

  private removeTraceCity(city: string): void {
    if (this.state.get(city)?.trace) {
      this.state.delete(city);
      this.activeCities$.next(new Map(this.state));
    }
  }
}
