import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { config } from './config';

const withAuth = (req: HttpRequest<unknown>, auth: AuthService) => {
  const tokens = auth.tokens();
  if (!req.url.startsWith(config.apiUrl)) return req;
  if (!tokens) return req.headers.has('X-Tenant') ? req : req.clone({ setHeaders: { 'X-Tenant': config.tenant } });
  return req.clone({ setHeaders: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Tenant': tokens.tenant.slug } });
};

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isAuthCall = req.url.includes('/auth/login') || req.url.includes('/auth/refresh') || req.url.includes('/food/signup');
  return next(withAuth(req, auth)).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401 || isAuthCall) return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap((ok) => (ok ? next(withAuth(req, auth)) : throwError(() => err))),
      );
    }),
  );
};
