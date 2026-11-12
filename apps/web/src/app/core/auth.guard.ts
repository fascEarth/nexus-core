import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loggedIn()) return router.parseUrl('/login');
  if (!auth.me()) {
    try {
      await auth.loadMe();
    } catch {
      return router.parseUrl('/login');
    }
  }
  return true;
};
