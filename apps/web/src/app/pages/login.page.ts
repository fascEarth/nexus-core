import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errorMessage } from '../core/api.service';

@Component({
  selector: 'nx-login',
  imports: [FormsModule],
  template: `
    <main class="auth">
      <form class="card auth-card" (ngSubmit)="submit()" autocomplete="on">
        <div class="brand"><span class="logo">N</span> Nexus Core</div>
        <p class="muted">Sign in to your workspace</p>
        <label>Workspace<input name="tenant" [(ngModel)]="tenant" required autocomplete="organization" /></label>
        <label>Email<input name="email" type="email" [(ngModel)]="email" required autocomplete="username" /></label>
        <label>Password<input name="password" type="password" [(ngModel)]="password" required autocomplete="current-password" /></label>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button class="btn primary" type="submit" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
        <p class="hint">Demo: workspace <b>acme</b> · admin&#64;acme.test · Admin&#64;12345</p>
      </form>
    </main>
  `,
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  tenant = 'acme';
  email = '';
  password = '';
  busy = signal(false);
  error = signal('');

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.tenant, this.email, this.password);
      await this.router.navigateByUrl('/app');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
