/**
 * AFYX Engineering Kit - React Native Cross-Language Bridge Resolver
 *
 * Bridges JavaScript callsites to native implementations across iOS and Android:
 * 1. Legacy Objective-C Bridge (`RCT_EXPORT_MODULE`, `RCT_EXPORT_METHOD`, `RCT_REMAP_METHOD`)
 * 2. Swift modules exposed through Objective-C shims (`RCT_EXTERN_MODULE`, `RCT_EXTERN_METHOD`)
 * 3. Java/Kotlin Modules (`@ReactMethod` annotated methods, `getName()`)
 * 4. Modern TurboModules (`TurboModuleRegistry.getEnforcing<Spec>`)
 * 5. Correlates JS `NativeModules.<Module>.<method>` and local destructuring aliases with native nodes.
 */

import type { Node } from '../../types';
import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';

interface NativeBridgeMethod {
  moduleName: string;
  jsName: string;
  node: Node;
}

interface BridgeIndex {
  byJsName: Map<string, NativeBridgeMethod[]>;
  aliases: Map<string, string>;
}

const contextBridgeCache: WeakMap<ResolutionContext, BridgeIndex> = new WeakMap();

function deriveDefaultObjcModuleName(className: string): string {
  return className.startsWith('RCT') && className.length > 3
    ? className.slice(3)
    : className;
}

function parseObjcBridgeExports(
  source: string,
  className: string | null
): Array<{ moduleName: string; jsName: string; nativeSelectorFirstKw: string; line: number }> {
  const records: Array<{ moduleName: string; jsName: string; nativeSelectorFirstKw: string; line: number }> = [];

  const moduleMatch = source.match(/RCT_EXPORT_MODULE\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)?\s*\)/);
  const moduleName = moduleMatch?.[1] ?? (className ? deriveDefaultObjcModuleName(className) : null);
  if (!moduleName) return records;

  const getLine = (idx: number): number => {
    let line = 1;
    for (let i = 0; i < idx && i < source.length; i++) {
      if (source.charCodeAt(i) === 10) line++;
    }
    return line;
  };

  const exportRegex = /RCT_EXPORT_METHOD\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(source)) !== null) {
    const kw = match[1];
    if (kw) records.push({ moduleName, jsName: kw, nativeSelectorFirstKw: kw, line: getLine(match.index) });
  }

  const remapRegex = /RCT_REMAP_METHOD\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((match = remapRegex.exec(source)) !== null) {
    const jsName = match[1];
    const nativeKw = match[2];
    if (jsName && nativeKw) {
      records.push({ moduleName, jsName, nativeSelectorFirstKw: nativeKw, line: getLine(match.index) });
    }
  }

  return records;
}

function extractObjcImplementationClassName(source: string): string | null {
  const match = source.match(/@implementation\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return match?.[1] ?? null;
}

export function parseObjcRNExterns(
  source: string
): Array<{ moduleName: string; className: string; jsName: string; nativeSelectorFirstKw: string; line: number }> {
  const entries: Array<{ moduleName: string; className: string; jsName: string; nativeSelectorFirstKw: string; line: number }> = [];
  const remap = source.match(
    /RCT_EXTERN_REMAP_MODULE\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/
  );
  const plain = source.match(/RCT_EXTERN_MODULE\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/);
  const moduleName = remap?.[1] ?? plain?.[1] ?? null;
  const className = remap?.[2] ?? plain?.[1] ?? null;
  if (!moduleName || !className) return entries;

  const computeLine = (idx: number): number => {
    let count = 1;
    for (let i = 0; i < idx && i < source.length; i++) {
      if (source.charCodeAt(i) === 10) count++;
    }
    return count;
  };

  const methodRegex = /RCT_EXTERN_METHOD\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = methodRegex.exec(source)) !== null) {
    const kw = m[1];
    if (kw) entries.push({ moduleName, className, jsName: kw, nativeSelectorFirstKw: kw, line: computeLine(m.index) });
  }

  const remapRegex = /RCT_EXTERN_REMAP_METHOD\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = remapRegex.exec(source)) !== null) {
    const jsName = m[1];
    const nativeKw = m[2];
    if (jsName && nativeKw) {
      entries.push({ moduleName, className, jsName, nativeSelectorFirstKw: nativeKw, line: computeLine(m.index) });
    }
  }

  return entries;
}

export function collectNativeModuleAliases(
  source: string,
  aliases: Map<string, string>,
  ambiguous: Set<string>
): void {
  const registerAlias = (alias: string, mod: string): void => {
    if (ambiguous.has(alias)) return;
    const existing = aliases.get(alias);
    if (existing !== undefined && existing !== mod) {
      aliases.delete(alias);
      ambiguous.add(alias);
      return;
    }
    aliases.set(alias, mod);
  };

  const directRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*NativeModules\.([A-Z][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = directRegex.exec(source)) !== null) {
    registerAlias(match[1]!, match[2]!);
  }

  const destructuredRegex = /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*NativeModules\b/g;
  while ((match = destructuredRegex.exec(source)) !== null) {
    for (const token of match[1]!.split(',')) {
      const binding = token.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (binding) {
        registerAlias(binding[2] ?? binding[1]!, binding[1]!);
      }
    }
  }
}

function parseJvmBridgeExports(source: string): Array<{ moduleName: string; jsName: string }> {
  const results: Array<{ moduleName: string; jsName: string }> = [];

  const getNameMatch = source.match(
    /\bgetName\s*\([^)]*\)\s*(?::\s*String)?\s*(?:=\s*|\{[^}]*return\s*)"([^"]+)"/
  );
  const classInheritMatch =
    source.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*ReactContextBaseJavaModule/) ??
    source.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*ReactPackage/);

  const moduleName = getNameMatch?.[1] ?? (classInheritMatch?.[1] ? classInheritMatch[1].replace(/Module$/, '') : null);
  if (!moduleName) return results;

  const reactMethodRegex =
    /@ReactMethod\b[^{]*?(?:\bfun\s+|\bvoid\s+|\bpublic\s+\w[\w<>\[\]]*\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = reactMethodRegex.exec(source)) !== null) {
    const methodName = match[1];
    if (methodName) {
      results.push({ moduleName, jsName: methodName });
    }
  }

  return results;
}

function parseTurboModuleSpecDefinition(
  source: string
): { moduleName: string; methods: string[] } | null {
  const regMatch = source.match(
    /TurboModuleRegistry\.(?:getEnforcing|get)\s*<[^>]*>\s*\(\s*['"]([^'"]+)['"]\s*\)/
  );
  if (!regMatch || !regMatch[1]) return null;
  const moduleName = regMatch[1];

  const ifaceMatch = source.match(/export\s+interface\s+Spec\b[^{]*\{([\s\S]*?)\n\}/);
  if (!ifaceMatch || !ifaceMatch[1]) return null;

  const declaredMethods: string[] = [];
  const methodRegex = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  let match: RegExpExecArray | null;
  while ((match = methodRegex.exec(ifaceMatch[1])) !== null) {
    const fn = match[1];
    if (fn) declaredMethods.push(fn);
  }

  return { moduleName, methods: declaredMethods };
}

const RN_EMITTER_BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set([
  'addListener',
  'removeListeners',
  'remove',
  'invalidate',
  'startObserving',
  'stopObserving',
]);

function buildReactNativeBridgeIndex(context: ResolutionContext): BridgeIndex {
  const cached = contextBridgeCache.get(context);
  if (cached) return cached;

  const byJsName = new Map<string, NativeBridgeMethod[]>();
  const aliases = new Map<string, string>();
  const ambiguousAliases = new Set<string>();
  const allRepoFiles = context.getAllFiles();

  const objcMethodsByKw = new Map<string, Node[]>();
  const jvmMethodsByName = new Map<string, Node[]>();
  const swiftMethodsByName = new Map<string, Node[]>();

  for (const node of context.getNodesByKind('method')) {
    if (node.language === 'objc') {
      const kw = node.name.includes(':') ? node.name.split(':')[0] : node.name;
      if (kw) {
        const arr = objcMethodsByKw.get(kw);
        if (arr) arr.push(node);
        else objcMethodsByKw.set(kw, [node]);
      }
    } else if (node.language === 'java' || node.language === 'kotlin') {
      const arr = jvmMethodsByName.get(node.name);
      if (arr) arr.push(node);
      else jvmMethodsByName.set(node.name, [node]);
    } else if (node.language === 'swift') {
      const arr = swiftMethodsByName.get(node.name);
      if (arr) arr.push(node);
      else swiftMethodsByName.set(node.name, [node]);
    }
  }

  for (const filePath of allRepoFiles) {
    if (filePath.endsWith('.m') || filePath.endsWith('.mm')) {
      const fileSource = context.readFile(filePath);
      if (!fileSource) continue;

      const clsName = extractObjcImplementationClassName(fileSource);
      const objcExports = parseObjcBridgeExports(fileSource, clsName);
      for (const item of objcExports) {
        if (RN_EMITTER_BUILTIN_FUNCTIONS.has(item.jsName)) continue;
        const candidateNodes = objcMethodsByKw.get(item.nativeSelectorFirstKw) ?? [];
        const matchingNode = candidateNodes.find((c) => c.filePath === filePath) ?? candidateNodes[0];
        if (!matchingNode) continue;

        const entry: NativeBridgeMethod = { moduleName: item.moduleName, jsName: item.jsName, node: matchingNode };
        const list = byJsName.get(item.jsName);
        if (list) list.push(entry);
        else byJsName.set(item.jsName, [entry]);
      }

      if (/RCT_EXTERN_(?:REMAP_)?MODULE\b/.test(fileSource)) {
        for (const ext of parseObjcRNExterns(fileSource)) {
          if (RN_EMITTER_BUILTIN_FUNCTIONS.has(ext.jsName)) continue;
          const candidates = (swiftMethodsByName.get(ext.nativeSelectorFirstKw) ?? [])
            .filter((c) => c.qualifiedName.split('::').includes(ext.className))
            .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine);

          const matchingNode = candidates[0];
          if (!matchingNode) continue;

          const entry: NativeBridgeMethod = { moduleName: ext.moduleName, jsName: ext.jsName, node: matchingNode };
          const list = byJsName.get(ext.jsName);
          if (list) list.push(entry);
          else byJsName.set(ext.jsName, [entry]);
        }
      }
    }

    if (/\.(?:[cm]?[jt]sx?)$/.test(filePath)) {
      const source = context.readFile(filePath);
      if (source && source.includes('NativeModules')) {
        collectNativeModuleAliases(source, aliases, ambiguousAliases);
      }
    }

    if (filePath.endsWith('.java') || filePath.endsWith('.kt')) {
      const source = context.readFile(filePath);
      if (!source) continue;
      const jvmExports = parseJvmBridgeExports(source);
      for (const item of jvmExports) {
        if (RN_EMITTER_BUILTIN_FUNCTIONS.has(item.jsName)) continue;
        const candidateNodes = jvmMethodsByName.get(item.jsName) ?? [];
        const matchingNode = candidateNodes.find((c) => c.filePath === filePath) ?? candidateNodes[0];
        if (!matchingNode) continue;

        const entry: NativeBridgeMethod = { moduleName: item.moduleName, jsName: item.jsName, node: matchingNode };
        const list = byJsName.get(item.jsName);
        if (list) list.push(entry);
        else byJsName.set(item.jsName, [entry]);
      }
    }

    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      const source = context.readFile(filePath);
      if (!source) continue;
      const spec = parseTurboModuleSpecDefinition(source);
      if (!spec) continue;

      for (const methodName of spec.methods) {
        if (RN_EMITTER_BUILTIN_FUNCTIONS.has(methodName)) continue;
        const objcCands = objcMethodsByKw.get(methodName) ?? [];
        const jvmCands = jvmMethodsByName.get(methodName) ?? [];
        for (const candidateNode of [...objcCands, ...jvmCands]) {
          const entry: NativeBridgeMethod = { moduleName: spec.moduleName, jsName: methodName, node: candidateNode };
          const list = byJsName.get(methodName);
          if (list) list.push(entry);
          else byJsName.set(methodName, [entry]);
        }
      }
    }
  }

  const generatedIndex: BridgeIndex = { byJsName, aliases };
  contextBridgeCache.set(context, generatedIndex);
  return generatedIndex;
}

export const reactNativeBridgeResolver: FrameworkResolver = {
  name: 'react-native-bridge',
  languages: ['javascript', 'typescript', 'tsx', 'jsx', 'objc'],

  extract(filePath: string, source: string): FrameworkExtractionResult {
    if (!filePath.endsWith('.m') && !filePath.endsWith('.mm')) return { nodes: [], references: [] };
    if (!/RCT_EXPORT_MODULE\b/.test(source)) return { nodes: [], references: [] };

    const exports = parseObjcBridgeExports(source, extractObjcImplementationClassName(source));
    const timestamp = Date.now();
    const createdNodes: Node[] = [];
    const registeredNames = new Set<string>();

    for (const exp of exports) {
      if (registeredNames.has(exp.jsName)) continue;
      registeredNames.add(exp.jsName);

      createdNodes.push({
        id: `rn-export:${filePath}:${exp.moduleName}.${exp.jsName}`,
        kind: 'method',
        name: exp.jsName,
        qualifiedName: `${filePath}::${exp.moduleName}.${exp.jsName}`,
        filePath,
        language: 'objc',
        startLine: exp.line,
        endLine: exp.line,
        startColumn: 0,
        endColumn: 0,
        isExported: true,
        docstring: `RCT_EXPORT_METHOD ${exp.nativeSelectorFirstKw} (module ${exp.moduleName})`,
        signature: `RCT_EXPORT_METHOD(${exp.nativeSelectorFirstKw}:…)`,
        updatedAt: timestamp,
      });
    }

    return { nodes: createdNodes, references: [] };
  },

  detect(context: ResolutionContext): boolean {
    const pkg = context.readFile('package.json');
    if (pkg && /["']react-native["']\s*:/.test(pkg)) return true;

    const files = context.getAllFiles();
    const limit = Math.min(files.length, 200);

    for (let i = 0; i < limit; i++) {
      const f = files[i];
      if (!f) continue;
      if (f.endsWith('.mm') || f.endsWith('.m')) {
        const src = context.readFile(f);
        if (src && /RCT_EXPORT_MODULE\b|RCT_EXTERN_(?:REMAP_)?MODULE\b/.test(src)) return true;
      }
      if (f.endsWith('.ts') || f.endsWith('.tsx')) {
        const src = context.readFile(f);
        if (src && /TurboModuleRegistry\.(?:get|getEnforcing)\s*</.test(src)) return true;
      }
    }

    return false;
  },

  claimsReference(_name: string): boolean {
    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (
      ref.language !== 'javascript' &&
      ref.language !== 'typescript' &&
      ref.language !== 'tsx' &&
      ref.language !== 'jsx'
    ) {
      return null;
    }

    const rawRefName = ref.referenceName;
    const lastDotIndex = rawRefName.lastIndexOf('.');
    const cleanMethodName = lastDotIndex >= 0 ? rawRefName.slice(lastDotIndex + 1) : rawRefName;

    const bridgeMaps = buildReactNativeBridgeIndex(context);
    const candidateEntries = bridgeMaps.byJsName.get(cleanMethodName);
    if (!candidateEntries || candidateEntries.length === 0) return null;

    const selectPlatformPriority = (methods: NativeBridgeMethod[]): NativeBridgeMethod | undefined =>
      methods.find((m) => m.node.language === 'objc') ??
      methods.find((m) => m.node.language === 'swift') ??
      methods[0];

    if (lastDotIndex >= 0) {
      const receiverQualifier = rawRefName.slice(0, lastDotIndex);
      const directMatch = receiverQualifier.match(/^NativeModules\.([A-Z][\w$]*)$/);
      const targetModuleName = directMatch ? directMatch[1]! : bridgeMaps.aliases.get(receiverQualifier) ?? null;

      if (targetModuleName !== null) {
        const exactModuleMethod = selectPlatformPriority(
          candidateEntries.filter((m) => m.moduleName === targetModuleName)
        );
        if (!exactModuleMethod) return null;

        return {
          original: ref,
          targetNodeId: exactModuleMethod.node.id,
          confidence: 0.95,
          resolvedBy: 'framework',
          metadata: { bridge: 'react-native', module: targetModuleName },
        };
      }
    }

    const fallbackCandidate = selectPlatformPriority(candidateEntries);
    if (!fallbackCandidate) return null;

    return {
      original: ref,
      targetNodeId: fallbackCandidate.node.id,
      confidence: 0.6,
      resolvedBy: 'framework',
      metadata: { bridge: 'react-native', module: fallbackCandidate.moduleName },
    };
  },
};
