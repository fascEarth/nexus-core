import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/api.service';
import { FoodApi, Coupon, Quote, rupees } from '../food.api';
import { AddressStore, CartStore } from '../shared/stores';

type Pay = 'upi' | 'card' | 'cod';

@Component({
  selector: 'fx-cart',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="fx-wrap" style="padding-top:16px">
      @if (!cart.count()) {
        <div class="fx-empty"><span>🛒</span><b>Your cart is empty</b><p class="fx-muted">Good food is always cooking. Go ahead, order some yummy items from the menu.</p><a class="fx-btn sm" routerLink="/">See restaurants near you</a></div>
      } @else {
        <div class="fx-two">
          <div class="fx-stack">
            <section class="fx-card">
              <h3>{{ cart.restaurantName() }}</h3>
              @for (l of cart.lines(); track l.id) {
                <div class="fx-line">
                  <span [class]="l.veg ? 'fx-veg' : 'fx-nonveg'"></span>
                  <span class="name">{{ l.emoji }} {{ l.name }}</span>
                  <div class="fx-stepper" style="box-shadow:none"><button (click)="cart.dec(l.id)" aria-label="Remove one">−</button><span>{{ l.qty }}</span><button (click)="cart.inc(l.id)" aria-label="Add one">+</button></div>
                  <b style="min-width:64px;text-align:right">{{ money(l.price * l.qty) }}</b>
                </div>
              }
              <textarea rows="2" placeholder="Any cooking requests? (e.g. less spicy)" [ngModel]="cart.notes()" (ngModelChange)="cart.notes.set($event)" style="margin-top:8px"></textarea>
            </section>

            <section class="fx-card">
              <h3>Offers &amp; coupons</h3>
              <div class="fx-coupon">
                <input placeholder="Enter coupon code" [(ngModel)]="code" (keyup.enter)="apply(code)" />
                <button class="fx-btn sm" (click)="apply(code)">Apply</button>
              </div>
              @if (q()?.coupon) { <p class="fx-muted" style="color:var(--veg)">✓ {{ q()!.coupon }} applied · you save {{ money(q()!.discount) }}</p> }
              @if (q()?.couponError) { <p class="error" style="margin-top:8px">{{ q()!.couponError }}</p> }
              <div class="fx-rail" style="margin-top:10px">
                @for (o of offers(); track o.id) {
                  <button class="fx-chip" [class.on]="cart.coupon() === o.code" (click)="apply(cart.coupon() === o.code ? '' : o.code)"><b>{{ o.code }}</b> · {{ o.title }}</button>
                }
              </div>
            </section>

            <section class="fx-card">
              <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Delivery address</h3><span class="fx-muted">{{ addr.list().length }} saved</span></div>
              @for (a of addr.list(); track $index) {
                <button class="fx-addr-opt" style="margin-top:10px" [class.on]="$index === addr.selected()" (click)="addr.select($index)">
                  <span>{{ a.label === 'Work' ? '🏢' : a.label === 'Home' ? '🏠' : '📍' }}</span>
                  <span><b>{{ a.label }}</b><br /><small class="fx-muted">{{ a.line }}</small></span>
                </button>
              }
              @if (q(); as qq) { <p class="fx-muted" style="margin:10px 0 0">🛵 {{ qq.distanceKm }} km away · delivery in about <b>{{ qq.etaMinutes }} mins</b></p> }
            </section>
          </div>

          <div class="fx-stack fx-sticky">
            <section class="fx-card fx-bill">
              <h3>Bill details</h3>
              @if (q(); as qq) {
                <div class="row2"><span>Item total</span><span>{{ money(qq.itemTotal) }}</span></div>
                <div class="row2"><span>Delivery fee · {{ qq.distanceKm }} km</span><span>{{ money(qq.deliveryFee) }}</span></div>
                <div class="row2"><span>Platform fee</span><span>{{ money(qq.platformFee) }}</span></div>
                <div class="row2"><span>GST &amp; restaurant charges</span><span>{{ money(qq.taxes) }}</span></div>
                @if (qq.discount) { <div class="row2 save"><span>Discount ({{ qq.coupon }})</span><span>−{{ money(qq.discount) }}</span></div> }
                <div class="row2 total"><span>To pay</span><span>{{ money(qq.total) }}</span></div>
                @if (qq.discount) { <p class="fx-muted save" style="margin:8px 0 0;color:var(--veg)">🎉 You saved {{ money(qq.discount) }} on this order</p> }
              } @else if (quoteError()) {
                <p class="error">{{ quoteError() }}</p>
              } @else { <p class="fx-muted">Calculating…</p> }
            </section>

            <section class="fx-card">
              <h3>Payment</h3>
              <div class="fx-pay">
                <label [class.on]="pay() === 'upi'"><input type="radio" name="pay" [checked]="pay() === 'upi'" (change)="pay.set('upi')" /> <span>📱 UPI<small>Simulated: no money moves</small></span></label>
                <label [class.on]="pay() === 'card'"><input type="radio" name="pay" [checked]="pay() === 'card'" (change)="pay.set('card')" /> <span>💳 Card<small>Simulated: no card details needed</small></span></label>
                <label [class.on]="pay() === 'cod'"><input type="radio" name="pay" [checked]="pay() === 'cod'" (change)="pay.set('cod')" /> <span>💵 Cash on delivery<small>Pay the rider at your door</small></span></label>
              </div>
            </section>

            @if (placeError()) { <p class="error">{{ placeError() }}</p> }
            @if (auth.loggedIn()) {
              <button class="fx-btn green" [disabled]="!q() || !!q()?.couponError || !q()?.restaurant?.isOpen || busy()" (click)="place()">
                {{ !q()?.restaurant?.isOpen && q() ? 'Restaurant is closed' : pay() === 'cod' ? 'Place order · ' + money(q()?.total) : 'Pay ' + money(q()?.total) + ' & place order' }}
              </button>
            } @else {
              <a class="fx-btn" style="text-align:center" routerLink="/login" [queryParams]="{ next: '/cart' }">Sign in to place your order</a>
            }
          </div>
        </div>
      }
    </div>

    @if (stage() !== 'idle') {
      <div class="fx-overlay">
        <div class="fx-sheet">
          <div class="fx-pay-anim">
            @if (stage() === 'paying') {
              <div class="fx-spinner"></div><b>{{ pay() === 'upi' ? 'Waiting for UPI approval…' : pay() === 'card' ? 'Authorising card…' : 'Placing your order…' }}</b>
              <small class="fx-muted">Demo payment gateway · nothing is charged</small>
            } @else {
              <div class="fx-check">✓</div><b>Order placed!</b><small class="fx-muted">{{ placed() }} · sending it to the restaurant</small>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class CartPage {
  cart = inject(CartStore);
  addr = inject(AddressStore);
  auth = inject(AuthService);
  private api = inject(FoodApi);
  private router = inject(Router);

  q = signal<Quote | null>(null);
  quoteError = signal('');
  placeError = signal('');
  offers = signal<Coupon[]>([]);
  pay = signal<Pay>('upi');
  busy = signal(false);
  stage = signal<'idle' | 'paying' | 'done'>('idle');
  placed = signal('');
  code = '';
  private seq = 0;

  constructor() {
    this.code = this.cart.coupon();
    void this.api.offers().then((o) => this.offers.set(o)).catch(() => undefined);
    effect(() => {
      const lines = this.cart.lines(), coupon = this.cart.coupon(), a = this.addr.current(), rid = this.cart.restaurantId();
      untracked(() => void this.requote(rid, lines.map((l) => ({ id: l.id, qty: l.qty })), coupon, a.lat, a.lng));
    });
  }

  private async requote(restaurantId: string | null, items: { id: string; qty: number }[], coupon: string, lat: number, lng: number) {
    if (!restaurantId || !items.length) return this.q.set(null);
    const n = ++this.seq;
    try {
      const res = await this.api.quote({ restaurantId, items, coupon: coupon || undefined, lat, lng });
      if (n === this.seq) { this.q.set(res); this.quoteError.set(''); }
    } catch (e) {
      if (n === this.seq) { this.q.set(null); this.quoteError.set(errorMessage(e)); }
    }
  }

  apply(code: string) {
    this.code = code.trim().toUpperCase();
    this.cart.coupon.set(this.code);
  }

  money = rupees;

  async place() {
    const q = this.q(), a = this.addr.current(), rid = this.cart.restaurantId();
    if (!q || !rid) return;
    this.busy.set(true);
    this.placeError.set('');
    this.stage.set('paying');
    try {
      await new Promise((r) => setTimeout(r, this.pay() === 'cod' ? 500 : 1600));
      const res = await this.api.place({
        restaurantId: rid, items: this.cart.lines().map((l) => ({ id: l.id, qty: l.qty })), coupon: q.coupon ?? undefined,
        lat: a.lat, lng: a.lng, address: a.line, paymentMethod: this.pay(), notes: this.cart.notes() || undefined,
      });
      this.placed.set(res.number);
      this.stage.set('done');
      this.cart.clear();
      setTimeout(() => void this.router.navigate(['/orders', res.id]), 1200);
    } catch (e) {
      this.stage.set('idle');
      this.placeError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
