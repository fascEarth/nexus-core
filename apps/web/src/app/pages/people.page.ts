import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage, type Member, type RoleInfo } from '../core/api.service';
import { AuthService } from '../core/auth.service';

/** Members, their roles, and the permission matrix each role grants. */
@Component({
  selector: 'nx-people',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="page-head">
      <div><h1>People &amp; access</h1><p class="muted">Role changes apply immediately, are audited and emit <code>core.user.roles_changed</code>.</p></div>
      <div class="seg">
        <button [class.active]="tab() === 'people'" (click)="tab.set('people')">People ({{ members().length }})</button>
        <button [class.active]="tab() === 'roles'" (click)="tab.set('roles')">Roles &amp; permissions ({{ roles().length }})</button>
      </div>
    </div>
    @if (error()) {<p class="error">{{ error() }}</p>}
    @if (msg()) {<p class="ok-text">{{ msg() }}</p>}

    @if (tab() === 'people') {
      <div class="card filters"><input [(ngModel)]="q" name="q" placeholder="Search name or email" /></div>
      <div class="card table-wrap">
        <table>
          <thead><tr><th>Member</th><th>Roles</th><th>Reports to</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
          <tbody>
            @for (m of filtered(); track m.id) {
              <tr class="static">
                <td><div class="who"><span class="avatar">{{ initials(m.name) }}</span><span><b>{{ m.name }}</b><br /><small class="muted">{{ m.email }}</small></span></div></td>
                <td>
                  @if (editing() === m.id) {
                    <div class="role-picks">
                      @for (r of roles(); track r.id) {<label class="check"><input type="checkbox" [checked]="draft().has(r.id)" (change)="toggle(r.id)" /> {{ r.name }}</label>}
                    </div>
                    <div class="actions"><button class="btn primary" (click)="saveRoles(m)">Save</button><button class="btn ghost" (click)="editing.set(null)">Cancel</button></div>
                  } @else {
                    @for (r of m.roles; track r.id) {<span class="pill">{{ r.name }}</span> }
                    @if (!m.roles.length) {<span class="muted small">No roles</span>}
                  }
                </td>
                <td>{{ m.manager ?? '—' }}</td>
                <td>{{ m.lastLoginAt ? (m.lastLoginAt | date: 'd MMM, h:mm a') : 'Never' }}</td>
                <td><span class="pill" [attr.data-kind]="m.status === 'active' ? 'ok' : 'bad'">{{ m.status }}</span></td>
                <td class="nowrap">
                  @if (editing() !== m.id) {<button class="btn" (click)="edit(m)">Edit roles</button>}
                  @if (m.userId !== auth.me()?.userId) {
                    <button class="btn ghost" [class.danger]="m.status === 'active'" (click)="toggleStatus(m)">{{ m.status === 'active' ? 'Suspend' : 'Reactivate' }}</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div class="card table-wrap">
        <table class="matrix">
          <thead><tr><th>Permission</th>@for (r of roles(); track r.id) {<th class="center">{{ r.name }}<br /><small class="muted">{{ r.members }} member{{ r.members === 1 ? '' : 's' }}</small></th>}</tr></thead>
          <tbody>
            @for (p of permissionKeys(); track p) {
              <tr class="static">
                <td><code>{{ p }}</code></td>
                @for (r of roles(); track r.id) {
                  <td class="center">@if (grant(r, p); as g) {<span class="scope" [attr.data-scope]="g.scope" [title]="g.permission">{{ g.scope }}{{ g.conditional ? ' *' : '' }}</span>} @else {<span class="muted">·</span>}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted small">Scopes: <b>own</b> = records you own · <b>team</b> = you and your reports · <b>org_unit</b> = your department · <b>all</b> = whole workspace. <code>*:*</code> grants everything. Field-level rules hide or lock individual fields per role.</p>
      @for (r of roles(); track r.id) {
        @if (r.fields.length) {
          <p class="small"><b>{{ r.name }}</b> field rules: @for (f of r.fields; track f.field) {<code>{{ f.entity }}.{{ f.field }} = {{ f.mode }}</code> }</p>
        }
      }
    }
  `,
})
export class PeoplePage implements OnInit {
  private api = inject(Api);
  auth = inject(AuthService);
  tab = signal<'people' | 'roles'>('people');
  members = signal<Member[]>([]);
  roles = signal<RoleInfo[]>([]);
  editing = signal<string | null>(null);
  draft = signal(new Set<string>());
  error = signal('');
  msg = signal('');
  q = '';

  filtered = () => {
    const q = this.q.trim().toLowerCase();
    return this.members().filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  };
  permissionKeys = computed(() => [...new Set(this.roles().flatMap((r) => r.permissions.map((p) => p.permission)))].sort((a, b) => (a === '*:*' ? -1 : b === '*:*' ? 1 : a.localeCompare(b))));

  ngOnInit() {
    void this.load();
  }

  async load() {
    try {
      const [m, r] = await Promise.all([this.api.members(), this.api.roles()]);
      this.members.set(m);
      this.roles.set(r);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  grant(r: RoleInfo, key: string) {
    return r.permissions.find((p) => p.permission === key) ?? null;
  }

  initials(n: string) {
    return n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  }

  edit(m: Member) {
    this.editing.set(m.id);
    this.draft.set(new Set(m.roles.map((r) => r.id)));
  }

  toggle(id: string) {
    const s = new Set(this.draft());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.draft.set(s);
  }

  async saveRoles(m: Member) {
    this.error.set(''); this.msg.set('');
    try {
      await this.api.setRoles(m.id, [...this.draft()]);
      this.msg.set(`Updated roles for ${m.name}`);
      this.editing.set(null);
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async toggleStatus(m: Member) {
    const next = m.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !confirm(`Suspend ${m.name}? They will be signed out and lose access.`)) return;
    this.error.set(''); this.msg.set('');
    try {
      await this.api.setMemberStatus(m.id, next);
      this.msg.set(`${m.name} is now ${next}`);
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
