import { HttpInterceptorFn } from '@angular/common/http';
import { from, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';
import { config } from './config';

/** Demo builds answer API calls from the in-browser simulator. Real builds pass straight through. */
export const demoInterceptor: HttpInterceptorFn = (req, next) => {
  if (!environment.demo || !req.url.startsWith(config.apiUrl)) return next(req);
  return from(import('../demo/nexus-demo-backend')).pipe(switchMap((m) => m.handle(req)));
};
