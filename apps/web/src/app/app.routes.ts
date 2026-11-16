import { Routes } from '@angular/router';
import { authGuard, sessionResolver } from './core/auth.guard';

const ADMIN = ['admin', 'ops'];

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login.page').then((m) => m.LoginPage) },

  // Restaurant partner app
  {
    path: 'partner',
    canActivate: [authGuard],
    data: { roles: ['restaurant', ...ADMIN] },
    loadComponent: () => import('./food/partner/partner-shell').then((m) => m.PartnerShell),
    children: [
      { path: '', loadComponent: () => import('./food/partner/board.page').then((m) => m.BoardPage) },
      { path: 'menu', loadComponent: () => import('./food/partner/menu.page').then((m) => m.PartnerMenuPage) },
      { path: 'insights', loadComponent: () => import('./food/partner/insights.page').then((m) => m.PartnerInsightsPage) },
    ],
  },

  // Delivery partner app
  {
    path: 'rider',
    canActivate: [authGuard],
    data: { roles: ['rider'] },
    loadComponent: () => import('./food/rider/rider-shell').then((m) => m.RiderShell),
    children: [
      { path: '', loadComponent: () => import('./food/rider/trip.page').then((m) => m.TripPage) },
      { path: 'earnings', loadComponent: () => import('./food/rider/earnings.page').then((m) => m.EarningsPage) },
    ],
  },

  // Admin console: the Nexus platform shell + food operations
  {
    path: 'app',
    canActivate: [authGuard],
    data: { roles: ADMIN },
    loadComponent: () => import('./pages/shell.page').then((m) => m.ShellPage),
    children: [
      { path: '', loadComponent: () => import('./pages/home.page').then((m) => m.HomePage) },
      { path: 'ops', loadComponent: () => import('./food/admin/ops.page').then((m) => m.OpsPage) },
      { path: 'insights', loadComponent: () => import('./food/admin/food-insights.page').then((m) => m.FoodInsightsPage) },
      { path: 'rules', loadComponent: () => import('./pages/rules.page').then((m) => m.RulesPage) },
      { path: 'activity', loadComponent: () => import('./pages/activity.page').then((m) => m.ActivityPage) },
      { path: 'people', loadComponent: () => import('./pages/people.page').then((m) => m.PeoplePage) },
      { path: 'events', loadComponent: () => import('./pages/events.page').then((m) => m.EventsPage) },
      { path: ':entity', loadComponent: () => import('./pages/entity-list.page').then((m) => m.EntityListPage) },
      { path: ':entity/:id', loadComponent: () => import('./pages/entity-form.page').then((m) => m.EntityFormPage) },
    ],
  },

  // Customer app (browse without signing in)
  {
    path: '',
    canActivate: [sessionResolver],
    loadComponent: () => import('./food/customer/customer-shell').then((m) => m.CustomerShell),
    children: [
      { path: '', loadComponent: () => import('./food/customer/home.page').then((m) => m.HomePage) },
      { path: 'r/:id', loadComponent: () => import('./food/customer/restaurant.page').then((m) => m.RestaurantPage) },
      { path: 'search', loadComponent: () => import('./food/customer/search.page').then((m) => m.SearchPage) },
      { path: 'cart', loadComponent: () => import('./food/customer/cart.page').then((m) => m.CartPage) },
      { path: 'orders', loadComponent: () => import('./food/customer/orders.page').then((m) => m.OrdersPage) },
      { path: 'orders/:id', canActivate: [authGuard], loadComponent: () => import('./food/customer/track.page').then((m) => m.TrackPage) },
      { path: 'account', loadComponent: () => import('./food/customer/account.page').then((m) => m.AccountPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
