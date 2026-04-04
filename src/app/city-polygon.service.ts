import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class CityPolygonService {
  // Only cache successful polygon results — nulls are never cached so they can be retried
  private cache = new Map<string, GeoJSON.Feature>();
  private inflight = new Map<string, Promise<GeoJSON.Feature | null>>();

  // Nominatim: max 1 req/s. Use 1.2s gap to be safe.
  private queue: Array<() => Promise<void>> = [];
  private processingQueue = false;
  private readonly RATE_MS = 100;
  private readonly RETRY_AFTER_429_MS = 10000;

  async fetchPolygon(hebrewName: string): Promise<GeoJSON.Feature | null> {
    if (this.cache.has(hebrewName)) return this.cache.get(hebrewName)!;
    if (this.inflight.has(hebrewName)) return this.inflight.get(hebrewName)!;

    const promise = new Promise<GeoJSON.Feature | null>((resolve) => {
      this.queue.push(async () => {
        const result = await this.query(hebrewName);
        if (result) this.cache.set(hebrewName, result); // only cache success
        this.inflight.delete(hebrewName);
        resolve(result);
      });
    });

    this.inflight.set(hebrewName, promise);
    this.drainQueue();
    return promise;
  }

  private async drainQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      await task();
      if (this.queue.length > 0) {
        await new Promise((r) => setTimeout(r, this.RATE_MS));
      }
    }

    this.processingQueue = false;
  }

  private async query(hebrewName: string): Promise<GeoJSON.Feature | null> {
    const params = new URLSearchParams({
      q: hebrewName,
      countrycodes: 'il',
      format: 'geojson',
      polygon_geojson: '1',
      limit: '1',
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${environment.nominatimBase}/search?${params}`, {
          headers: { 'Accept-Language': 'he' },
        });

        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, this.RETRY_AFTER_429_MS));
          continue;
        }

        if (!res.ok) return null;

        const geojson: GeoJSON.FeatureCollection = await res.json();
        const feature = geojson.features[0] ?? null;

        if (!feature || feature.geometry.type === 'Point') return null;

        return feature;
      } catch {
        return null;
      }
    }

    return null;
  }
}
