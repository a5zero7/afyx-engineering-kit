import { describe, it, expect } from 'vitest';
import { AngularExtractor } from '../src/extraction/angular-extractor';
import { extractFromSource } from '../src/extraction/extract';
import { getFrameworkResolver } from '../src/resolution/frameworks';

describe('Angular Native Semantic Extractor (B1.2 / AFYX-223)', () => {
  it('1. extracts @Component metadata, selector, templateUrl, standalone imports, @Input/@Output, and DI', () => {
    const source = `
      import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
      import { CommonModule } from '@angular/common';
      import { AuthService } from './auth.service';
      import { UserBadgeComponent } from './user-badge.component';

      @Component({
        selector: 'app-user-profile',
        standalone: true,
        imports: [CommonModule, UserBadgeComponent],
        templateUrl: './user-profile.component.html',
      })
      export class UserProfileComponent {
        @Input() userId!: string;
        @Output() saved = new EventEmitter<void>();

        private readonly logger = inject(LoggerService);

        constructor(private readonly auth: AuthService) {}
      }
    `;

    const res = new AngularExtractor('src/app/user-profile.component.ts', source).extract();
    expect(res.errors).toHaveLength(0);

    const compNode = res.nodes.find((n) => n.kind === 'component' && n.name === 'UserProfileComponent');
    expect(compNode).toBeDefined();
    expect(compNode?.decorators).toContain('selector:app-user-profile');
    expect(compNode?.decorators).toContain('standalone:true');
    expect(compNode?.decorators).toContain('templateUrl:./user-profile.component.html');

    const inputNode = res.nodes.find((n) => n.kind === 'property' && n.name === 'userId');
    const outputNode = res.nodes.find((n) => n.kind === 'property' && n.name === 'saved');
    expect(inputNode?.decorators).toContain('@Input');
    expect(outputNode?.decorators).toContain('@Output');

    const refNames = res.unresolvedReferences.map((r) => r.referenceName);
    expect(refNames).toContain('src/app/user-profile.component.html');
    expect(refNames).toContain('CommonModule');
    expect(refNames).toContain('UserBadgeComponent');
    expect(refNames).toContain('AuthService');
    expect(refNames).toContain('LoggerService');
  });

  it('2. extracts @NgModule declarations, imports, exports, providers, and bootstrap', () => {
    const source = `
      import { NgModule } from '@angular/core';
      @NgModule({
        declarations: [DashboardComponent, SidebarDirective],
        imports: [SharedModule],
        exports: [DashboardComponent],
        providers: [MetricsService],
        bootstrap: [AppComponent],
      })
      export class DashboardModule {}
    `;

    const res = new AngularExtractor('src/app/dashboard.module.ts', source).extract();
    const modNode = res.nodes.find((n) => n.kind === 'module' && n.name === 'DashboardModule');
    expect(modNode).toBeDefined();
    const meta = JSON.parse(modNode?.docstring ?? '{}');
    expect(meta.declarations).toEqual(['DashboardComponent', 'SidebarDirective']);
    expect(meta.exports).toEqual(['DashboardComponent']);

    const relations = res.unresolvedReferences.map(
      (r) => `${r.candidates?.[0]}:${r.referenceName}`,
    );
    expect(relations).toContain('angular:ngModule_declarations:DashboardComponent');
    expect(relations).toContain('angular:ngModule_imports:SharedModule');
    expect(relations).toContain('angular:ngModule_providers:MetricsService');
    expect(relations).toContain('angular:ngModule_bootstrap:AppComponent');
  });

  it('3. extracts @Injectable, @Directive, and @Pipe declarations', () => {
    const source = `
      import { Injectable, Directive, Pipe } from '@angular/core';

      @Injectable({ providedIn: 'root' })
      export class ApiService {}

      @Directive({ selector: '[appHighlight]', standalone: true })
      export class HighlightDirective {}

      @Pipe({ name: 'currencyFormat', standalone: true })
      export class CurrencyFormatPipe {}
    `;

    const res = new AngularExtractor('src/app/shared.ts', source).extract();
    const api = res.nodes.find((n) => n.name === 'ApiService');
    const dir = res.nodes.find((n) => n.name === 'HighlightDirective');
    const pipe = res.nodes.find((n) => n.name === 'CurrencyFormatPipe');

    expect(api?.decorators).toContain('providedIn:root');
    expect(dir?.decorators).toContain('selector:[appHighlight]');
    expect(pipe?.decorators).toContain('pipe:currencyFormat');
  });

  it('4. extracts Angular routing declarations (Routes, RouterModule, loadComponent, loadChildren)', () => {
    const source = `
      import { Routes } from '@angular/router';
      import { HomeComponent } from './home.component';

      export const routes: Routes = [
        { path: 'home', component: HomeComponent },
        {
          path: 'admin',
          loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent),
        },
        {
          path: 'billing',
          loadChildren: () => import('./billing/billing.routes').then((m) => m.BILLING_ROUTES),
        },
      ];
    `;

    const res = new AngularExtractor('src/app/app.routes.ts', source).extract();
    const routeNodes = res.nodes.filter((n) => n.kind === 'route');
    expect(routeNodes.map((r) => r.name)).toEqual(['/home', '/admin', '/billing']);

    const refs = res.unresolvedReferences.map((r) => r.referenceName);
    expect(refs).toContain('HomeComponent');
    expect(refs).toContain('./admin/admin.component');
    expect(refs).toContain('./billing/billing.routes');
  });

  it('5. marks dynamic metadata honestly as unresolved rather than inventing targets', () => {
    const source = `
      import { Component } from '@angular/core';
      const dynUrl = computeTemplate();
      @Component({
        selector: 'app-dyn',
        templateUrl: dynUrl,
        imports: getDynamicImports(),
      })
      export class DynComponent {}
    `;

    const res = new AngularExtractor('src/app/dyn.component.ts', source).extract();
    const dynRelations = res.unresolvedReferences
      .filter((r) => r.candidates?.some((c) => c.startsWith('angular:unresolved:')))
      .map((r) => r.candidates?.[0]);
    expect(dynRelations).toEqual([
      'angular:unresolved:dynamic_templateUrl',
      'angular:unresolved:dynamic_imports',
    ]);
  });

  it('6. degrades safely on malformed or incomplete Angular syntax', () => {
    const malformed = `
      import { Component } from '@angular/core';
      @Component({
        selector: 'app-broken',
        imports: [UnclosedModule
      export class BrokenComponent {
    `;

    const res = new AngularExtractor('src/app/broken.component.ts', malformed).extract();
    expect(res.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
  });

  it('7. emits zero Angular nodes for non-Angular TypeScript files', () => {
    const plainTs = `
      export function add(a: number, b: number): number {
        return a + b;
      }
      export class PlainCalculator {}
    `;

    const res = new AngularExtractor('src/math.ts', plainTs).extract();
    expect(res.nodes).toHaveLength(0);
    expect(res.unresolvedReferences).toHaveLength(0);
  });

  it('8. integrates cleanly with extractFromSource and framework resolver registry', () => {
    const resolver = getFrameworkResolver('angular');
    expect(resolver).toBeDefined();

    const source = `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-root', template: '<h1>Hi</h1>' })
      export class AppComponent {}
    `;
    const combined = extractFromSource('src/app/app.component.ts', source, 'typescript', ['angular']);
    const compNode = combined.nodes.find((n) => n.kind === 'component' && n.name === 'AppComponent');
    expect(compNode).toBeDefined();
    expect(compNode?.decorators).toContain('inlineTemplate:true');
  });
});
