import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errorMessage } from '../core/api.service';
import { environment } from '../../environments/environment';

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
        @if (demo) {
          <div class="demo-box">
            <b>Live demo · pick a user</b>
            <div class="demo-users">
              <button type="button" class="btn" (click)="signInAs('employee@acme.test', 'Employee@12345')">Employee<small>raises requests</small></button>
              <button type="button" class="btn" (click)="signInAs('manager@acme.test', 'Manager@12345')">Manager<small>approves team</small></button>
              <button type="button" class="btn" (click)="signInAs('admin@acme.test', 'Admin@12345')">Admin<small>HR, finance, rules</small></button>
            </div>
            <p class="hint">Tip: open a second tab as another user. Actions in one tab appear live in the other. Data stays in your browser.</p>
          </div>
        } @else {
          <p class="hint">Demo: workspace <b>acme</b> · admin&#64;acme.test · Admin&#64;12345</p>
        }
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
  demo = environment.demo;
  error = signal('');

  signInAs(email: string, password: string) {
    this.tenant = 'acme';
    this.email = email;
    this.password = password;
    void this.submit();
  }

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
