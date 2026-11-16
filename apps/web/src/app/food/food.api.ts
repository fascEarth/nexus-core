import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { config } from '../core/config';
import type { RecordRow } from '../core/api.service';
import type { Tokens } from '../core/auth.service';

export interface Restaurant {
  id: string; name: string; area: string; cuisines: string; rating: number; ratingCount: number; isOpen: boolean;
  costForTwo: number; prepMinutes: number; veg: boolean; offer: string; emoji: string; theme: string; lat: number; lng: number;
  phone?: string; etaMinutes: number; dishes?: string[]; minPrice?: number; orgUnitId?: string;
}
export interface MenuItem {
  id: string; name: string; category: string; price: number; available: boolean; veg: boolean; bestseller: boolean;
  emoji: string; description: string; restaurantId: string; restaurantName: string;
}
export interface Line { id: string; name: string; price: number; qty: number; veg: boolean }
export type OrderStatus = 'placed' | 'accepted' | 'ready' | 'picked_up' | 'delivered' | 'cancelled' | 'rejected';
export interface Order {
  id: string; number: string; status: OrderStatus; createdAt: string; updatedAt: string; ownerId: string;
  customerName: string; restaurantName: string; restaurantId: string; total: number; paymentMethod: 'upi' | 'card' | 'cod';
  paymentStatus: string; paymentRef?: string | null; itemCount: number; items: Line[]; itemTotal: number; deliveryFee: number;
  platformFee: number; taxes: number; discount: number; coupon?: string | null; address: string; dropLat: number; dropLng: number;
  distanceKm: number; etaMinutes: number; notes?: string | null; deliveryId?: string; riderId?: string; riderName?: string;
  riderPhone?: string; riderVehicle?: string; foodRating?: number | null; riderRating?: number | null; review?: string | null;
  deliveredAt?: string; deliveryMinutes?: number; cancelReason?: string | null; restaurantEmoji?: string; restaurantTheme?: string;
  prepSeconds?: number;
}
export interface Delivery {
  id: string; number: string; status: 'assigned' | 'picked_up' | 'delivered' | 'cancelled'; createdAt: string; updatedAt: string; ownerId: string;
  orderNumber: string; riderName: string; restaurantName: string; customerName: string; payout: number; distanceKm: number; orderId: string;
  address: string; startLat: number; startLng: number; pickupLat: number; pickupLng: number; dropLat: number; dropLng: number;
  approachSeconds: number; travelSeconds: number; assignedAt: string; pickedUpAt?: string; deliveredAt?: string;
}
export interface RiderProfile {
  id: string; ownerId: string; name: string; vehicle: string; online: boolean; rating: number; zone: string; phone: string; bot: boolean;
  lat: number; lng: number; busy?: boolean;
}
export interface Coupon { id: string; code: string; title: string; kind: 'percent' | 'flat' | 'free_delivery'; value: number; maxDiscount: number; minOrder: number; theme: string }
export interface Quote {
  lines: Line[]; itemTotal: number; deliveryFee: number; platformFee: number; taxes: number; discount: number; coupon: string | null;
  couponError?: string; total: number; distanceKm: number; etaMinutes: number; restaurant: { id: string; name: string; isOpen: boolean };
}
export interface Track {
  order: Order;
  restaurant: { id: string; name: string; area: string; lat: number; lng: number; emoji: string; theme: string; phone?: string };
  delivery: Delivery | null;
  rider: { name: string; vehicle: string; rating: number; phone: string } | null;
  timeline: { state: string; at: string; comment?: string | null }[];
  serverTime: number;
}
export interface PartnerBoard {
  restaurant: Restaurant; active: Order[]; recent: Order[];
  today: { orders: number; delivered: number; sales: number; declined: number };
  restaurants?: { id: string; name: string }[]; serverTime: number;
}
export interface PartnerInsights {
  restaurant: Restaurant; days: string[]; orders: number[]; sales: number[]; hours: number[];
  topDishes: { name: string; qty: number; revenue: number }[]; ratings: { stars: number; count: number }[];
  reviews: { number: string; customer: string; rating: number; review: string; at: string }[];
  totals: { orders: number; delivered: number; sales: number; avgOrder: number; declineRate: number };
}
export interface RiderHome {
  profile: RiderProfile; active: Delivery | null; order: Order | null;
  today: { trips: number; earnings: number; km: number };
  week: { days: string[]; earnings: number[]; trips: number };
  trips: Delivery[]; serverTime: number;
}
export interface Live {
  active: Order[]; deliveries: Delivery[]; riders: RiderProfile[];
  restaurants: { id: string; name: string; lat: number; lng: number; isOpen: boolean; emoji: string; area: string }[];
  counters: { activeOrders: number; ridersOnline: number; ridersBusy: number; ordersToday: number; gmvToday: number; cancelledToday: number; openRestaurants: number; restaurants: number };
  recent: Order[]; serverTime: number;
}
export interface FoodInsights {
  days: string[]; orders: number[]; gmv: number[]; deliveryMinutes: number[]; hours: number[];
  status: { status: string; count: number }[]; payments: { method: string; count: number }[];
  coupons: { code: string; uses: number; discount: number }[];
  restaurants: { name: string; orders: number; gmv: number; rating: number | null; declineRate: number }[];
  dishes: { name: string; restaurant: string; qty: number }[];
  totals: { orders: number; delivered: number; gmv: number; aov: number; avgDeliveryMinutes: number; cancelRate: number; customers: number; repeatCustomers: number; discounts: number };
}

export const STATUS_LABEL: Record<string, string> = {
  placed: 'Order placed', accepted: 'Preparing', ready: 'Ready for pickup', picked_up: 'Out for delivery',
  delivered: 'Delivered', cancelled: 'Cancelled', rejected: 'Declined', assigned: 'Rider assigned',
};

@Injectable({ providedIn: 'root' })
export class FoodApi {
  private http = inject(HttpClient);
  private url = `${config.apiUrl}/food`;

  private get<T>(path: string, params?: Record<string, string | undefined>) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') p = p.set(k, v);
    return firstValueFrom(this.http.get<T>(`${this.url}${path}`, { params: p }));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.url}${path}`, body));
  }
  private put<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(`${this.url}${path}`, body));
  }

  restaurants() { return this.get<Restaurant[]>('/restaurants'); }
  restaurant(id: string) { return this.get<{ restaurant: Restaurant; menu: MenuItem[] }>(`/restaurants/${id}`); }
  search(q: string) { return this.get<{ restaurants: Restaurant[]; dishes: (MenuItem & { isOpen: boolean })[] }>('/search', { q }); }
  offers() { return this.get<Coupon[]>('/offers'); }
  quote(body: { restaurantId: string; items: { id: string; qty: number }[]; coupon?: string; lat?: number; lng?: number }) { return this.post<Quote>('/quote', body); }
  signup(body: { name: string; email: string; password: string }) { return this.post<Tokens>('/signup', body); }

  place(body: { restaurantId: string; items: { id: string; qty: number }[]; coupon?: string; lat: number; lng: number; address: string; paymentMethod: string; notes?: string }) {
    return this.post<{ id: string; number: string; total: number }>('/orders', body);
  }
  myOrders() { return this.get<Order[]>('/orders/mine'); }
  track(id: string) { return this.get<Track>(`/orders/${id}/track`); }
  cancel(id: string, reason: string) { return this.post(`/orders/${id}/cancel`, { reason }); }
  rate(id: string, body: { foodRating: number; riderRating?: number; review?: string }) { return this.post(`/orders/${id}/rate`, body); }

  board(restaurantId?: string) { return this.get<PartnerBoard>('/partner/board', { restaurantId }); }
  menu(restaurantId?: string) { return this.get<{ restaurant: Restaurant; menu: MenuItem[] }>('/partner/menu', { restaurantId }); }
  partnerInsights(restaurantId?: string) { return this.get<PartnerInsights>('/partner/insights', { restaurantId }); }
  partnerAction(orderId: string, action: 'accept' | 'reject' | 'ready', comment?: string) { return this.post(`/partner/orders/${orderId}/${action}`, { comment }); }
  patchRestaurant(id: string, body: { isOpen?: boolean; prepMinutes?: number; offer?: string }) { return this.put<RecordRow>(`/partner/restaurant/${id}`, body); }
  patchMenu(id: string, body: { available?: boolean; price?: number; bestseller?: boolean }) { return this.put<RecordRow>(`/partner/menu/${id}`, body); }
  addMenu(body: { restaurantId?: string; name: string; price: number; category: string; veg: boolean; emoji?: string; description?: string }) { return this.post<RecordRow>('/partner/menu', body); }

  riderHome() { return this.get<RiderHome>('/rider/home'); }
  riderOnline(online: boolean) { return this.put<RecordRow>('/rider/online', { online }); }
  riderAction(deliveryId: string, action: 'pick_up' | 'deliver') { return this.post(`/rider/deliveries/${deliveryId}/${action}`); }

  live() { return this.get<Live>('/admin/live'); }
  insights(days = 30) { return this.get<FoodInsights>('/admin/insights', { days: String(days) }); }
}

export function themeBg(theme?: string) {
  const [a, b] = (theme || '#f97316,#facc15').split(',');
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function rupees(n: number | null | undefined) {
  return '₹' + Math.round(n ?? 0).toLocaleString('en-IN');
}
