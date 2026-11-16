import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errorMessage } from '../core/api.service';
import { config } from '../core/config';
import { FoodApi } from '../food/food.api';

const DEMO_PASSWORD = 'Demo@12345';
const ROLES = [
  { email: 'customer@nexeats.test', title: 'Customer', icon: '😋', bg: '#fff1eb', text: 'Browse 10 restaurants, add to cart, apply coupons, pay (simulated) and track your rider live on the map.' },
  { email: 'partner@nexeats.test', title: 'Restaurant partner', icon: '👨‍🍳', bg: '#fef3c7', text: 'Kovai Biryani House: accept or decline orders, mark food ready, manage menu and stock, see sales.' },
  { email: 'rider@nexeats.test', title: 'Delivery partner', icon: '🛵', bg: '#ccfbf1', text: 'Go online, get trips first, pick up and drop with turn-by-turn map, track earnings.' },
  { email: 'admin@nexeats.test', title: 'Admin console', icon: '🛰️', bg: '#e0e7ff', text: 'Live operations map, business insights, plus the Nexus platform: entities, workflows, rules, events, audit.' },
];

@Component({
  selector: 'nx-login',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="fx-login">
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <a class="fx-logo" routerLink="/" style="font-size:1.4rem"><i style="width:40px;height:40px;font-size:22px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(135deg,#f2542d,#ff8a3d);color:#fff;font-style:normal">🍽</i><span>NexEats</span></a>
          <small class="muted">A full food-delivery business built on <b>Nexus Core</b></small>
        </div>
        <div>
          <h1 style="margin:0 0 6px">Pick a role to explore</h1>
          <p class="muted" style="margin:0">Open two or three tabs as different roles and watch an order move between them in real time.</p>
        </div>
        <div class="fx-roles">
          @for (r of roles; track r.email) {
            <button class="fx-role" (click)="signInAs(r.email)" [disabled]="busy()">
              <span class="ic" [style.background]="r.bg">{{ r.icon }}</span>
              <b>{{ r.title }}</b>
              <small>{{ r.text }}</small>
              <small style="color:#f2542d;font-weight:600">{{ busy() === r.email ? 'Signing in…' : 'Enter →' }}</small>
            </button>
          }
        </div>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

        <div class="fx-two" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
          <form class="card pad" style="display:grid;gap:12px" (ngSubmit)="submit()" autocomplete="on">
            <b>Sign in with email</b>
            <label>Email<input name="email" type="email" [(ngModel)]="email" required autocomplete="username" /></label>
            <label>Password<input name="password" type="password" [(ngModel)]="password" required autocomplete="current-password" /></label>
            <button class="btn primary" type="submit" [disabled]="!!busy()">Sign in</button>
            <p class="hint">All demo accounts use the password <b>{{ demoPassword }}</b>.</p>
          </form>
          <form class="card pad" style="display:grid;gap:12px" (ngSubmit)="signup()">
            <b>New customer? Create an account</b>
            <label>Name<input name="sname" [(ngModel)]="sname" required autocomplete="name" /></label>
            <label>Email<input name="semail" type="email" [(ngModel)]="semail" required autocomplete="email" /></label>
            <label>Password<input name="spass" type="password" [(ngModel)]="spass" required autocomplete="new-password" placeholder="10+ chars, upper, lower, digit" /></label>
            <button class="btn" type="submit" [disabled]="!!busy()">Create account</button>
          </form>
        </div>
        <p class="hint" style="text-align:center">Payments and rider movement are simulated · maps © OpenStreetMap contributors · data resets nightly</p>
      </div>
    </main>
  `,
})
export class LoginPage {
  private auth = inject(AuthService);
  private food = inject(FoodApi);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  roles = ROLES;
  demoPassword = DEMO_PASSWORD;
  email = '';
  password = '';
  sname = '';
  semail = '';
  spass = '';
  busy = signal<string | null>(null);
  error = signal('');

  signInAs(email: string) {
    this.email = email;
    this.password = DEMO_PASSWORD;
    void this.submit();
  }

  async submit() {
    this.busy.set(this.email);
    this.error.set('');
    try {
      await this.auth.login(config.tenant, this.email, this.password);
      await this.go();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async signup() {
    this.busy.set('signup');
    this.error.set('');
    try {
      await this.auth.useTokens(await this.food.signup({ name: this.sname, email: this.semail, password: this.spass }));
      await this.go();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  private async go() {
    const next = this.route.snapshot.queryParamMap.get('next');
    const home = this.auth.home();
    // Customers return to where they were (e.g. the cart); other roles go to their app.
    await this.router.navigateByUrl(next && home === '/' ? next : home);
  }
}
