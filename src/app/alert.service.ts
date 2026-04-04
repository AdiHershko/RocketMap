import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../environments/environment';

export interface CityAlert {
  cat: string;
  title: string;
  desc: string;
  timestamp: number;
  clearing?: boolean; // true = all-clear received, show green briefly
}

const ALL_CLEAR_TITLE = 'האירוע הסתיים';
const EARLY_WARNING_TITLE = 'התראה מקדימה';
const EARLY_WARNING_DESC = 'בדקות הקרובות צפויות להתקבל התראות';
const CLEAR_DISPLAY_MS = 2500; // how long to show green before removing

@Injectable({ providedIn: 'root' })
export class AlertService implements OnDestroy {
  private intervalId: ReturnType<typeof setInterval> | null = null;
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

      if (data.title === ALL_CLEAR_TITLE) {
        for (const city of data.data) {
          const existing = this.state.get(city);
          if (existing && !existing.clearing) {
            // Mark as clearing — show green briefly then remove
            this.state.set(city, { ...existing, title: ALL_CLEAR_TITLE, clearing: true });
            changed = true;
            setTimeout(() => this.removeClearedCity(city), CLEAR_DISPLAY_MS);
          }
        }
      } else {
        const effectiveTitle = data.desc?.includes(EARLY_WARNING_DESC)
          ? EARLY_WARNING_TITLE
          : data.title;
        for (const city of data.data) {
          this.state.set(city, {
            cat: data.cat,
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
