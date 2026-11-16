import { AfterViewInit, Component, effect, ElementRef, input, OnDestroy, output, viewChild } from '@angular/core';
import * as L from 'leaflet';
import type { LatLng } from './geo';

export interface MapMarker {
  id: string;
  at: LatLng;
  /** Emoji or short text shown in the pin. */
  icon: string;
  kind?: 'restaurant' | 'home' | 'rider' | 'closed' | 'busy' | 'idle';
  title?: string;
}
export interface MapLine {
  id: string;
  points: LatLng[];
  color?: string;
  dashed?: boolean;
}

/**
 * OpenStreetMap via Leaflet (free, no key). Markers are emoji pins, so no image
 * assets are needed. Markers move smoothly when their position changes.
 */
@Component({
  selector: 'fx-map',
  template: `<div #host class="fx-map-host"></div>`,
  styles: [':host{display:block;position:relative;z-index:0} .fx-map-host{width:100%;height:100%;min-height:inherit;border-radius:inherit}'],
})
export class FoodMap implements AfterViewInit, OnDestroy {
  readonly markers = input<MapMarker[]>([]);
  readonly lines = input<MapLine[]>([]);
  /** Change this value to re-fit the view to all markers. */
  readonly fitKey = input<string>('');
  readonly center = input<LatLng>([11.0168, 76.9558]);
  readonly zoom = input(13);
  readonly picked = output<LatLng>();

  private host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private map?: L.Map;
  private pins = new Map<string, L.Marker>();
  private polylines = new Map<string, L.Polyline>();
  private lastFit = '';

  constructor() {
    effect(() => this.syncMarkers(this.markers()));
    effect(() => this.syncLines(this.lines()));
    effect(() => {
      const key = this.fitKey();
      if (this.map && key && key !== this.lastFit) this.fit(key);
    });
  }

  ngAfterViewInit() {
    this.map = L.map(this.host().nativeElement, { zoomControl: true, attributionControl: true }).setView(this.center(), this.zoom());
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => this.picked.emit([e.latlng.lat, e.latlng.lng]));
    this.syncMarkers(this.markers());
    this.syncLines(this.lines());
    if (this.fitKey()) this.fit(this.fitKey());
    // The host may size itself after first paint (flex/grid layouts).
    setTimeout(() => this.map?.invalidateSize(), 200);
  }

  ngOnDestroy() {
    this.map?.remove();
  }

  private icon(m: MapMarker) {
    return L.divIcon({
      className: '',
      html: `<div class="fx-pin fx-pin-${m.kind ?? 'restaurant'}" title="${(m.title ?? '').replace(/"/g, '&quot;')}">${m.icon}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  }

  private syncMarkers(list: MapMarker[]) {
    if (!this.map) return;
    const seen = new Set<string>();
    for (const m of list) {
      seen.add(m.id);
      const existing = this.pins.get(m.id);
      if (existing) {
        existing.setLatLng(m.at);
        const el = existing.getElement()?.querySelector('.fx-pin');
        if (el && (el.textContent !== m.icon || !el.classList.contains(`fx-pin-${m.kind ?? 'restaurant'}`))) existing.setIcon(this.icon(m));
      } else {
        const pin = L.marker(m.at, { icon: this.icon(m), zIndexOffset: m.kind === 'rider' ? 1000 : 0 });
        if (m.title) pin.bindTooltip(m.title, { direction: 'top', offset: [0, -18] });
        pin.addTo(this.map);
        this.pins.set(m.id, pin);
      }
    }
    for (const [id, pin] of this.pins) if (!seen.has(id)) { pin.remove(); this.pins.delete(id); }
  }

  private syncLines(list: MapLine[]) {
    if (!this.map) return;
    const seen = new Set<string>();
    for (const l of list) {
      seen.add(l.id);
      const existing = this.polylines.get(l.id);
      if (existing) existing.setLatLngs(l.points);
      else this.polylines.set(l.id, L.polyline(l.points, { color: l.color ?? '#f2542d', weight: 4, opacity: 0.85, dashArray: l.dashed ? '6 8' : undefined }).addTo(this.map));
    }
    for (const [id, line] of this.polylines) if (!seen.has(id)) { line.remove(); this.polylines.delete(id); }
  }

  private fit(key: string) {
    this.lastFit = key;
    const pts = [...this.markers().map((m) => m.at), ...this.lines().flatMap((l) => l.points)];
    if (pts.length === 1) this.map!.setView(pts[0], 15);
    else if (pts.length) this.map!.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
  }
}
