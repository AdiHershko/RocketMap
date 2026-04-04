import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../environments/environment';

export interface CityAlert {
  cat: string;
  title: string;
  desc: string;
  timestamp: number;
  clearing?: boolean;
}

export interface HistoryEntry {
  id: string;
  cat: string;
  title: string;
  cities: string[];
  timestamp: number;
}

const ALL_CLEAR_TITLE = 'האירוע הסתיים';
const CLEAR_DISPLAY_MS = 2500;

// Derive alert type from title text (cat field is unreliable)
function typeFromTitle(title: string, desc: string): 'all-clear' | 'early-warning' | 'aircraft' | 'rockets' {
  if (title.includes('הסתיים')) return 'all-clear';
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
    this.fetchAlerts();
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
      const isAllClear    = type === 'all-clear';
      const isEarlyWarning = type === 'early-warning';
      const effectiveCat  = isEarlyWarning ? '5' : type === 'aircraft' ? '2' : '1';
      const effectiveTitle = data.title;

      if (isAllClear) {
        for (const city of data.data) {
          const existing = this.state.get(city);
          if (existing && !existing.clearing) {
            this.state.set(city, { ...existing, title: ALL_CLEAR_TITLE, clearing: true });
            changed = true;
            setTimeout(() => this.removeClearedCity(city), CLEAR_DISPLAY_MS);
          }
        }
      } else {
        for (const city of data.data) {
          this.state.set(city, {
            cat: effectiveCat,
            title: effectiveTitle,
            desc: data.desc,
            timestamp: Date.now(),
          });
          changed = true;
        }
      }

      if (changed) {
        this.activeCities$.next(new Map(this.state));
      }

      // Record to history (deduplicate by alert id)
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
      // ignore parse/network errors, preserve state
    }
  }

  private removeClearedCity(city: string): void {
    if (this.state.get(city)?.clearing) {
      this.state.delete(city);
      this.activeCities$.next(new Map(this.state));
    }
  }
}
