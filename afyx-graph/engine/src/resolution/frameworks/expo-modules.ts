/**
 * AFYX Engineering Kit - Expo Modules Framework Resolver
 *
 * Analyzes Swift and Kotlin native modules written with the Expo Modules DSL.
 * Extracts exposed methods and properties (`Function`, `AsyncFunction`, `Property`, `Constants`)
 * from `definition()` blocks into first-class graph method nodes, bridging JavaScript callsites
 * directly to their native implementations.
 */

import type { Node } from '../../types';
import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
} from '../types';

const EXPO_MODULE_DECLARATION_REGEX =
  /\b(Function|AsyncFunction|Property|Constants)\s*(?:<[^(]*>)?\s*\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g;

const EXPO_MODULE_EXPLICIT_NAME_REGEX = /\bName\s*\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/;
const EXPO_MODULE_CLASS_INHERITANCE_REGEX = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*Module\b/;

/**
 * Checks whether source text represents an Expo native module definition.
 */
function isExpoModuleDefinition(sourceText: string): boolean {
  if (!EXPO_MODULE_CLASS_INHERITANCE_REGEX.test(sourceText)) return false;
  EXPO_MODULE_DECLARATION_REGEX.lastIndex = 0;
  return EXPO_MODULE_DECLARATION_REGEX.test(sourceText);
}

/**
 * Extracts synthetic method nodes from Swift and Kotlin Expo Module source files.
 */
function extractExpoModuleDeclarations(
  filePath: string,
  sourceCode: string,
  sourceLanguage: 'swift' | 'kotlin'
): Node[] {
  if (!isExpoModuleDefinition(sourceCode)) return [];

  const explicitNameMatch = sourceCode.match(EXPO_MODULE_EXPLICIT_NAME_REGEX);
  const classInheritanceMatch = sourceCode.match(EXPO_MODULE_CLASS_INHERITANCE_REGEX);
  const resolvedModuleName = explicitNameMatch?.[1] ?? classInheritanceMatch?.[1] ?? 'ExpoModule';

  const extractedNodes: Node[] = [];
  const processedLineSignatures = new Set<string>();
  const timestamp = Date.now();

  EXPO_MODULE_DECLARATION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = EXPO_MODULE_DECLARATION_REGEX.exec(sourceCode)) !== null) {
    const dslKeyword = match[1]!;
    const exposedMethodName = match[2]!;

    const prefixText = sourceCode.slice(0, match.index);
    const lineIndex = prefixText.split('\n').length;
    const deduplicationKey = `${exposedMethodName}::${lineIndex}`;

    if (processedLineSignatures.has(deduplicationKey)) continue;
    processedLineSignatures.add(deduplicationKey);

    const columnOffset = prefixText.length - prefixText.lastIndexOf('\n') - 1;
    const estimatedSpan = dslKeyword.length + 2 + exposedMethodName.length + 2;

    extractedNodes.push({
      id: `expo-module:${filePath}:${resolvedModuleName}:${exposedMethodName}:${lineIndex}`,
      kind: 'method',
      name: exposedMethodName,
      qualifiedName: `${filePath}::${resolvedModuleName}.${exposedMethodName}`,
      filePath,
      language: sourceLanguage,
      startLine: lineIndex,
      endLine: lineIndex,
      startColumn: columnOffset,
      endColumn: columnOffset + estimatedSpan,
      docstring: `Expo Modules ${dslKeyword}("${exposedMethodName}") in ${resolvedModuleName}`,
      signature: `${dslKeyword}("${exposedMethodName}")`,
      isExported: true,
      updatedAt: timestamp,
    });
  }

  return extractedNodes;
}

export const expoModulesResolver: FrameworkResolver = {
  name: 'expo-modules',
  languages: ['swift', 'kotlin'],

  detect(context: ResolutionContext): boolean {
    const packageManifest = context.readFile('package.json');
    if (packageManifest && /["']expo-modules-core["']\s*:/.test(packageManifest)) {
      return true;
    }

    const availableFiles = context.getAllFiles();
    const probeLimit = Math.min(availableFiles.length, 200);

    for (let i = 0; i < probeLimit; i++) {
      const file = availableFiles[i];
      if (!file) continue;

      if (file.endsWith('.swift') || file.endsWith('.kt')) {
        const fileContent = context.readFile(file);
        if (fileContent && isExpoModuleDefinition(fileContent)) {
          return true;
        }
      }
    }

    return false;
  },

  extract(filePath: string, source: string): FrameworkExtractionResult {
    const lang = filePath.endsWith('.kt') ? 'kotlin' : 'swift';
    return {
      nodes: extractExpoModuleDeclarations(filePath, source, lang),
      references: [],
    };
  },

  resolve() {
    return null;
  },
};
