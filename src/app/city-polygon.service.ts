import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CityPolygonService {
  // Cache: Hebrew city name → GeoJSON feature (or null if not found)
  private cache = new Map<string, GeoJSON.Feature | null>();
  // Pending requests: avoid duplicate in-flight fetches for the same city
  private inflight = new Map<string, Promise<GeoJSON.Feature | null>>();

  async fetchPolygon(hebrewName: string): Promise<GeoJSON.Feature | null> {
    if (this.cache.has(hebrewName)) {
      return this.cache.get(hebrewName)!;
    }
    if (this.inflight.has(hebrewName)) {
      return this.inflight.get(hebrewName)!;
    }

    const promise = this.query(hebrewName);
    this.inflight.set(hebrewName, promise);
    const result = await promise;
    this.cache.set(hebrewName, result);
    this.inflight.delete(hebrewName);
    return result;
  }

  private async query(hebrewName: string): Promise<GeoJSON.Feature | null> {
    try {
      const params = new URLSearchParams({
        q: hebrewName,
        countrycodes: 'il',
        format: 'geojson',
        polygon_geojson: '1',
        limit: '1',
      });

      const res = await fetch(`/api/nominatim/search?${params}`, {
        headers: { 'Accept-Language': 'he' },
      });

      if (!res.ok) return null;

      const geojson: GeoJSON.FeatureCollection = await res.json();
      const feature = geojson.features[0] ?? null;

      // Only use polygon/multipolygon geometries; reject points
      if (!feature || feature.geometry.type === 'Point') return null;

      return feature;
    } catch {
      return null;
    }
  }
}
