import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthService } from './auth.service';

/** `<button *nxCan="'leave:approve'">` — renders only when the user holds the permission. */
@Directive({ selector: '[nxCan]' })
export class CanDirective {
  private auth = inject(AuthService);
  private tpl = inject(TemplateRef);
  private vcr = inject(ViewContainerRef);
  readonly nxCan = input.required<string>();
  private shown = false;

  constructor() {
    effect(() => {
      const [resource, action] = this.nxCan().split(':');
      const allowed = this.auth.can(resource, action);
      if (allowed && !this.shown) this.vcr.createEmbeddedView(this.tpl);
      if (!allowed && this.shown) this.vcr.clear();
      this.shown = allowed;
    });
  }
}
