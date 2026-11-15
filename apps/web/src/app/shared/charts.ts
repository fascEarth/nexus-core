/**
 * Lightweight, dependency-free SVG charts. Each chart scales to its container width
 * (viewBox) and exposes values to screen readers via <title> and aria-labels.
 */
import { Component, computed, input } from '@angular/core';

const PALETTE = ['#4f46e5', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#84cc16'];

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function compact(n: number): string {
  if (Math.abs(n) >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (Math.abs(n) >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n * 10) / 10}`;
}

export interface BarDatum { label: string; value: number; title?: string }

@Component({
  selector: 'nx-bar-chart',
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + height()" role="img" [attr.aria-label]="ariaLabel()" class="chart">
      @for (g of grid(); track g.y) {
        <line [attr.x1]="L" [attr.x2]="W" [attr.y1]="g.y" [attr.y2]="g.y" class="grid" />
        <text [attr.x]="L - 6" [attr.y]="g.y + 4" class="axis" text-anchor="end">{{ g.label }}</text>
      }
      @for (b of bars(); track $index) {
        <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" rx="3" [style.fill]="color()" class="bar"><title>{{ b.title }}</title></rect>
        @if (b.showLabel) {<text [attr.x]="b.x + b.w / 2" [attr.y]="height() - 6" class="axis" text-anchor="middle">{{ b.label }}</text>}
      }
    </svg>
  `,
})
export class BarChart {
  readonly data = input<BarDatum[]>([]);
  readonly height = input(200);
  readonly color = input('var(--brand)');
  readonly format = input<(n: number) => string>(compact);
  readonly ariaLabel = input('Bar chart');
  readonly W = 640;
  readonly L = 42;
  private max = computed(() => niceMax(Math.max(0, ...this.data().map((d) => d.value))));
  grid = computed(() => {
    const h = this.height() - 24;
    return [0, 0.5, 1].map((f) => ({ y: 8 + (h - 8) * (1 - f), label: this.format()(this.max() * f) }));
  });
  bars = computed(() => {
    const d = this.data();
    const h = this.height() - 24;
    const slot = (this.W - this.L) / Math.max(1, d.length);
    const every = Math.ceil(d.length / 12);
    return d.map((v, i) => {
      const bh = ((h - 8) * v.value) / this.max();
      return { x: this.L + i * slot + slot * 0.18, w: slot * 0.64, y: 8 + (h - 8) - bh, h: Math.max(bh, v.value ? 2 : 0), label: v.label, title: v.title ?? `${v.label}: ${this.format()(v.value)}`, showLabel: i % every === 0 };
    });
  });
}

export interface LineSeries { name: string; values: (number | null)[]; color?: string; dashed?: boolean }

@Component({
  selector: 'nx-line-chart',
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + height()" role="img" [attr.aria-label]="ariaLabel()" class="chart">
      @if (bandRect(); as b) {<rect [attr.x]="L" [attr.width]="W - L" [attr.y]="b.y" [attr.height]="b.h" class="band"><title>Reference range</title></rect>}
      @for (g of grid(); track g.y) {
        <line [attr.x1]="L" [attr.x2]="W" [attr.y1]="g.y" [attr.y2]="g.y" class="grid" />
        <text [attr.x]="L - 6" [attr.y]="g.y + 4" class="axis" text-anchor="end">{{ g.label }}</text>
      }
      @for (s of paths(); track s.name) {
        @if (s.area) {<path [attr.d]="s.area" [style.fill]="s.color" opacity="0.08" />}
        <path [attr.d]="s.d" fill="none" [style.stroke]="s.color" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" [attr.stroke-dasharray]="s.dashed ? '5 4' : null" />
        @for (p of s.points; track $index) {<circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" [style.fill]="s.color"><title>{{ p.title }}</title></circle>}
      }
      @for (x of xLabels(); track $index) {<text [attr.x]="x.x" [attr.y]="height() - 6" class="axis" text-anchor="middle">{{ x.label }}</text>}
    </svg>
    @if (series().length > 1) {
      <div class="legend">@for (s of paths(); track s.name) {<span><i [style.background]="s.color"></i>{{ s.name }}</span>}</div>
    }
  `,
})
export class LineChart {
  readonly labels = input<string[]>([]);
  readonly series = input<LineSeries[]>([]);
  readonly height = input(220);
  readonly band = input<[number, number] | null>(null);
  readonly area = input(true);
  readonly ariaLabel = input('Line chart');
  readonly W = 640;
  readonly L = 42;
  private range = computed(() => {
    const vals = this.series().flatMap((s) => s.values.filter((v): v is number => v !== null));
    const b = this.band();
    if (b) vals.push(...b);
    if (!vals.length) return { lo: 0, hi: 1 };
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
    lo -= pad; hi += pad;
    return { lo: lo < 0 && Math.min(...vals) >= 0 ? 0 : lo, hi };
  });
  private y = (v: number) => {
    const { lo, hi } = this.range();
    const h = this.height() - 24;
    return 8 + (h - 8) * (1 - (v - lo) / (hi - lo || 1));
  };
  private x = (i: number) => this.L + 8 + ((this.W - this.L - 16) * i) / Math.max(1, this.labels().length - 1);
  grid = computed(() => {
    const { lo, hi } = this.range();
    return [0, 0.5, 1].map((f) => { const v = lo + (hi - lo) * f; return { y: this.y(v), label: compact(v) }; });
  });
  bandRect = computed(() => {
    const b = this.band();
    if (!b) return null;
    const top = this.y(b[1]);
    return { y: top, h: Math.max(0, this.y(b[0]) - top) };
  });
  paths = computed(() => this.series().map((s, si) => {
    const color = s.color ?? PALETTE[si % PALETTE.length];
    const pts = s.values.map((v, i) => (v === null ? null : { x: this.x(i), y: this.y(v), title: `${this.labels()[i] ?? ''} · ${s.name}: ${v}` })).filter((p): p is { x: number; y: number; title: string } => !!p);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const base = this.height() - 24;
    const area = this.area() && pts.length > 1 && this.series().length === 1 ? `${d} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z` : null;
    return { name: s.name, color, d, area, points: pts.length <= 40 ? pts : [], dashed: s.dashed };
  }));
  xLabels = computed(() => {
    const l = this.labels();
    const every = Math.ceil(l.length / 8);
    // Show evenly spaced labels; include the last one only if it doesn't crowd the previous label.
    return l.map((label, i) => ({ label, x: this.x(i), show: i % every === 0 || (i === l.length - 1 && i % every >= every / 2) })).filter((v) => v.show);
  });
}

@Component({
  selector: 'nx-donut',
  template: `
    <div class="donut">
      <svg viewBox="0 0 120 120" role="img" [attr.aria-label]="ariaLabel()">
        @for (s of arcs(); track s.label) {
          <circle cx="60" cy="60" r="46" fill="none" [style.stroke]="s.color" stroke-width="18" [attr.stroke-dasharray]="s.dash" [attr.stroke-dashoffset]="s.offset" transform="rotate(-90 60 60)"><title>{{ s.label }}: {{ s.value }}</title></circle>
        }
        <text x="60" y="58" text-anchor="middle" class="donut-total">{{ total() }}</text>
        <text x="60" y="74" text-anchor="middle" class="axis">{{ centerLabel() }}</text>
      </svg>
      <ul class="legend vertical">
        @for (s of arcs(); track s.label) {<li><i [style.background]="s.color"></i><span>{{ s.label }}</span><b>{{ s.pct }}%</b></li>}
      </ul>
    </div>
  `,
})
export class Donut {
  readonly data = input<{ label: string; value: number }[]>([]);
  readonly centerLabel = input('total');
  readonly ariaLabel = input('Donut chart');
  total = computed(() => this.data().reduce((s, d) => s + d.value, 0));
  arcs = computed(() => {
    const C = 2 * Math.PI * 46;
    const total = this.total() || 1;
    let acc = 0;
    return this.data().filter((d) => d.value > 0).map((d, i) => {
      const len = (C * d.value) / total;
      const out = { label: d.label, value: d.value, color: PALETTE[i % PALETTE.length], dash: `${len} ${C - len}`, offset: -acc, pct: Math.round((d.value / total) * 100) };
      acc += len;
      return out;
    });
  });
}

@Component({
  selector: 'nx-heatmap',
  template: `
    <div class="heatmap" role="img" [attr.aria-label]="ariaLabel()">
      <div class="hm-row hm-head"><span></span>@for (h of hours(); track h) {<span class="axis">{{ h % 3 === 0 ? h : '' }}</span>}</div>
      @for (row of rows(); track row.day) {
        <div class="hm-row"><span class="axis">{{ row.day }}</span>
          @for (c of row.cells; track $index) {<span class="hm-cell" [style.opacity]="c.o" [title]="row.day + ' ' + c.h + ':00 · ' + c.v"></span>}
        </div>
      }
    </div>
  `,
})
export class Heatmap {
  /** 7 rows (Mon..Sun) × 24 hour columns. */
  readonly matrix = input<number[][]>([]);
  readonly fromHour = input(7);
  readonly toHour = input(23);
  readonly ariaLabel = input('Busiest hours');
  hours = computed(() => Array.from({ length: this.toHour() - this.fromHour() }, (_, i) => i + this.fromHour()));
  rows = computed(() => {
    const max = Math.max(1, ...this.matrix().flat());
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, d) => ({
      day, cells: this.hours().map((h) => { const v = this.matrix()[d]?.[h] ?? 0; return { h, v, o: v ? 0.15 + 0.85 * (v / max) : 0.06 }; }),
    }));
  });
}

@Component({
  selector: 'nx-sparkline',
  template: `
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" class="spark" aria-hidden="true">
      <path [attr.d]="d()" fill="none" [style.stroke]="color()" stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>
  `,
})
export class Sparkline {
  readonly values = input<number[]>([]);
  readonly color = input('var(--brand)');
  d = computed(() => {
    const v = this.values();
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v);
    return v.map((y, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * 100).toFixed(1)},${(26 - ((y - lo) / (hi - lo || 1)) * 24).toFixed(1)}`).join(' ');
  });
}

@Component({
  selector: 'nx-kpi',
  template: `
    <div class="kpi card">
      <span class="muted small">{{ label() }}</span>
      <b class="kpi-value">{{ value() }}</b>
      @if (change() !== null && change() !== undefined) {
        <span class="delta" [class.up]="(change() ?? 0) > 0" [class.down]="(change() ?? 0) < 0">{{ (change() ?? 0) > 0 ? '▲' : (change() ?? 0) < 0 ? '▼' : '•' }} {{ abs(change() ?? 0) }}% <span class="muted">{{ changeLabel() }}</span></span>
      } @else if (hint()) {<span class="muted small">{{ hint() }}</span>}
    </div>
  `,
})
export class Kpi {
  readonly label = input('');
  readonly value = input<string | number>('');
  readonly change = input<number | null | undefined>(undefined);
  readonly changeLabel = input('vs last month');
  readonly hint = input('');
  abs = Math.abs;
}
