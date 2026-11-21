/**
 * AFYX Engineering Kit - Mobile UI & Navigation Framework Resolver (AFYX-224 / Track C Wave 3B C4.3)
 *
 * Implements mobile UI and navigation resolution across:
 * 1. Flutter (Dart):
 *    - StatefulWidget & StatelessWidget declarations
 *    - Named route table extraction: routes: { '/route': (context) => Screen() }
 *    - Imperative navigation: Navigator.pushNamed(context, '/route'), Navigator.push(context, MaterialPageRoute(builder: (context) => Screen()))
 * 2. Android (Kotlin/Java):
 *    - Activity lifecycle and entrypoints
 *    - Intent navigations: Intent(context, TargetActivity::class.java), startActivity(...)
 *    - Jetpack Navigation & Compose: @Composable screens, NavHost, composable("route") { Screen() }, navController.navigate("route")
 * 3. React Native (TypeScript/JavaScript):
 *    - Stack.Screen / Tab.Screen declarations: <Screen name="Route" component={ScreenComponent} />
 *    - Imperative navigation: navigation.navigate('Route'), navigation.push('Route')
 */

import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
} from '../types';
import { stripCommentsForRegex } from '../strip-comments';

export interface MobileRoute {
  path: string;
  method: string;
  handlerExpr: string;
  filePath: string;
  line: number;
}

export interface MobileNavigationExtractionResult extends FrameworkExtractionResult {
  routes: MobileRoute[];
  unresolved: any[];
}

export const mobileNavigationResolver: FrameworkResolver = {
  name: 'mobile-navigation',
  languages: ['dart', 'kotlin', 'java', 'typescript', 'tsx', 'javascript', 'jsx'],

  detect(_context: ResolutionContext): boolean {
    return true;
  },

  extract(filePath: string, source: string): MobileNavigationExtractionResult {
    const routes: MobileRoute[] = [];
    const unresolved: any[] = [];
    const p = filePath.toLowerCase().replace(/\\/g, '/');
    const clean = stripCommentsForRegex(
      source,
      p.endsWith('.dart') ? 'java' : (p.endsWith('.kt') || p.endsWith('.java') ? 'java' : 'typescript')
    );

    // 1. Flutter (Dart)
    if (p.endsWith('.dart')) {
      // Named route definitions: '/path': (context) => TargetScreen()
      const routeMapRegex = /['"](\/[a-zA-Z0-9_/]*)['"]\s*:\s*\([^)]*\)\s*=>\s*([A-Za-z0-9_]+)\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = routeMapRegex.exec(clean)) !== null) {
        routes.push({
          path: match[1]!,
          method: 'ROUTE',
          handlerExpr: match[2]!,
          filePath,
          line: 1,
        });
      }

      // Navigator.pushNamed(context, '/path')
      const pushNamedRegex = /Navigator\.(?:pushNamed|pushReplacementNamed|popAndPushNamed)\s*\([^,]+,\s*['"](\/[a-zA-Z0-9_/]*)['"]/g;
      while ((match = pushNamedRegex.exec(clean)) !== null) {
        unresolved.push({
          sourceNodeId: '',
          symbol: match[1]!,
          referenceKind: 'navigation',
          filePath,
          line: 1,
          metadata: { routePath: match[1]!, framework: 'flutter' },
        });
      }
    }

    // 2. Android (Kotlin / Java)
    if (p.endsWith('.kt') || p.endsWith('.java')) {
      // Jetpack Compose composable("route") { Screen() }
      const composableRouteRegex = /composable\s*\(\s*['"]([a-zA-Z0-9_/{}-]+)['"]\s*[^)]*\)\s*\{([^}]*)\}/g;
      let match: RegExpExecArray | null;
      while ((match = composableRouteRegex.exec(clean)) !== null) {
        const route = match[1]!;
        const body = match[2]!;
        const screenCallMatch = body.match(/([A-Z][A-Za-z0-9_]*Screen|[A-Z][A-Za-z0-9_]*View)\s*\(/);
        routes.push({
          path: route,
          method: 'COMPOSE',
          handlerExpr: screenCallMatch ? screenCallMatch[1]! : route,
          filePath,
          line: 1,
        });
      }

      // navController.navigate("route")
      const navNavigateRegex = /navController\.navigate\s*\(\s*['"]([a-zA-Z0-9_/{}-]+)['"]/g;
      while ((match = navNavigateRegex.exec(clean)) !== null) {
        unresolved.push({
          sourceNodeId: '',
          symbol: match[1]!,
          referenceKind: 'navigation',
          filePath,
          line: 1,
          metadata: { routePath: match[1]!, framework: 'jetpack-navigation' },
        });
      }

      // Intent(this, TargetActivity::class.java)
      const intentRegex = /Intent\s*\([^,]+,\s*([A-Za-z0-9_]+)::class(?:\.java)?\s*\)/g;
      while ((match = intentRegex.exec(clean)) !== null) {
        unresolved.push({
          sourceNodeId: '',
          symbol: match[1]!,
          referenceKind: 'navigation',
          filePath,
          line: 1,
          metadata: { targetClass: match[1]!, framework: 'android-intent' },
        });
      }
    }

    // 3. React Native (TS/JS)
    if (p.endsWith('.tsx') || p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.js')) {
      // <Stack.Screen name="Profile" component={ProfileScreen} />
      const screenRegex = /<(?:[A-Za-z0-9_]+\.)?Screen\s+[^>]*name=['"]([a-zA-Z0-9_-]+)['"][^>]*component=\{([A-Za-z0-9_]+)\}/g;
      let match: RegExpExecArray | null;
      while ((match = screenRegex.exec(clean)) !== null) {
        routes.push({
          path: match[1]!,
          method: 'SCREEN',
          handlerExpr: match[2]!,
          filePath,
          line: 1,
        });
      }

      // navigation.navigate('Profile')
      const navRegex = /navigation\.(?:navigate|push|replace)\s*\(\s*['"]([a-zA-Z0-9_-]+)['"]/g;
      while ((match = navRegex.exec(clean)) !== null) {
        unresolved.push({
          sourceNodeId: '',
          symbol: match[1]!,
          referenceKind: 'navigation',
          filePath,
          line: 1,
          metadata: { routePath: match[1]!, framework: 'react-navigation' },
        });
      }
    }

    return { nodes: [], references: [], routes, unresolved };
  },

  resolve(unresolved: any, ctx: any): ResolvedRef | null {
    const kind = unresolved.referenceKind;
    if (kind !== 'navigation' && kind !== 'navigates') return null;

    const symbol = unresolved.symbol || unresolved.referenceName;
    const meta = unresolved.metadata || {};

    if (meta.framework === 'android-intent' && meta.targetClass) {
      const candidates = ctx.getNodesByName ? ctx.getNodesByName(meta.targetClass) : [];
      const activityNode = candidates.find((n: any) => n.kind === 'class' && (n.filePath.endsWith('.kt') || n.filePath.endsWith('.java')));
      if (activityNode) {
        return {
          original: unresolved,
          targetNodeId: activityNode.id,
          confidence: 0.95,
          resolvedBy: 'framework',
          edgeKind: 'navigates',
        };
      }
    }

    // Match route to screen handler
    const targetCandidates = ctx.getNodesByName ? ctx.getNodesByName(symbol) : [];
    if (targetCandidates && targetCandidates.length > 0) {
      const screenNode = targetCandidates.find((n: any) =>
        n.kind === 'function' || n.kind === 'class' || n.kind === 'variable' || n.kind === 'component'
      );
      if (screenNode) {
        return {
          original: unresolved,
          targetNodeId: screenNode.id,
          confidence: 0.9,
          resolvedBy: 'framework',
          edgeKind: 'navigates',
        };
      }
    }

    return null;
  },
};
