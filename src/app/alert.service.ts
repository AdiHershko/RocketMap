import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface CityAlert {
  cat: string;
  title: string;
  desc: string;
  timestamp: number;
}

const ALL_CLEAR_TITLE = 'האירוע הסתיים';

@Injectable({ providedIn: 'root' })
export class AlertService implements OnDestroy {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  // Accumulated active alerts keyed by city name
  private state = new Map<string, CityAlert>();
  readonly activeCities$ = new BehaviorSubject<Map<string, CityAlert>>(new Map());

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
      const res = await fetch('/api/oref/WarningMessages/alert/alerts.json', {
        cache: 'no-store',
      });

      if (!res.ok) return;

      const text = (await res.text()).trim().replace(/^\uFEFF/, '');
      if (!text) return; // empty = nothing changed

      const data = JSON.parse(text) as {
        id: string;
        cat: string;
        title: string;
        data: string[];
        desc: string;
      };

      if (!data.data?.length) return;

      let changed = false;

      if (data.title === ALL_CLEAR_TITLE) {
        for (const city of data.data) {
          if (this.state.has(city)) {
            this.state.delete(city);
            changed = true;
          }
        }
      } else {
        for (const city of data.data) {
          this.state.set(city, { cat: data.cat, title: data.title, desc: data.desc, timestamp: Date.now() });
          changed = true;
        }
      }

      if (changed) {
        this.activeCities$.next(new Map(this.state));
      }
    } catch {
      // ignore parse/network errors, preserve existing state
    }
  }
}
