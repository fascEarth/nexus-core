import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { AuthService } from './auth.service';

/** Requires a session. Optional `data.roles`: users without one of them go to their own home. */
export const authGuard: CanActivateFn = async (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.loggedIn()) return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
  if (!auth.me()) {
    try {
      await auth.loadMe();
    } catch {
      return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
    }
  }
  const roles = route.data?.['roles'] as string[] | undefined;
  if (roles && !auth.hasRole(...roles)) return router.parseUrl(auth.home());
  return true;
};

/** Loads the profile if signed in, but never blocks (public customer pages). */
export const sessionResolver: CanActivateFn = async () => {
  const auth = inject(AuthService);
  if (auth.loggedIn() && !auth.me()) await auth.loadMe().catch(() => undefined);
  return true;
};
