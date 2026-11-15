import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login.page').then((m) => m.LoginPage) },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/shell.page').then((m) => m.ShellPage),
    children: [
      { path: '', loadComponent: () => import('./pages/home.page').then((m) => m.HomePage) },
      { path: 'inbox', loadComponent: () => import('./pages/inbox.page').then((m) => m.InboxPage) },
      { path: 'rules', loadComponent: () => import('./pages/rules.page').then((m) => m.RulesPage) },
      { path: 'activity', loadComponent: () => import('./pages/activity.page').then((m) => m.ActivityPage) },
      { path: 'people', loadComponent: () => import('./pages/people.page').then((m) => m.PeoplePage) },
      { path: 'events', loadComponent: () => import('./pages/events.page').then((m) => m.EventsPage) },
      { path: ':entity', loadComponent: () => import('./pages/entity-list.page').then((m) => m.EntityListPage) },
      { path: ':entity/:id', loadComponent: () => import('./pages/entity-form.page').then((m) => m.EntityFormPage) },
    ],
  },
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  { path: '**', redirectTo: 'app' },
];
