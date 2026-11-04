import type { Edge, ExtractionResult, Node } from '../../types';
import { generateNodeId } from '../node-id';

const LOG_ANNOTATIONS = new Set([
  'Slf4j', 'Log4j', 'Log4j2', 'Log', 'CommonsLog', 'JBossLog', 'Flogger', 'XSlf4j', 'CustomLog',
]);
const FIELD_MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'final', 'transient', 'volatile']);
const LOMBOK_ANNOTATION_RE = /@(?:[A-Za-z_$][\w$]*\.)*(?:Getter|Setter|Data|Value|Builder|SuperBuilder|ToString|EqualsAndHashCode|Slf4j|Log4j2?|Log|CommonsLog|JBossLog|Flogger|XSlf4j|CustomLog)\b/;

function annotationsAt(lines: readonly string[], line: number): Set<string> {
  const text: string[] = [lines[line - 1] ?? ''];
  for (let cursor = line - 2; cursor >= 0; cursor -= 1) {
    const value = lines[cursor]!.trim();
    if (!value.startsWith('@') || value.replace(/@(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:\([^)]*\))?/g, '').trim()) break;
    text.unshift(value);
  }
  return new Set([...text.join('\n').matchAll(/@(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)/g)]
    .map((match) => match[1]!));
}

function capitalize(name: string): string {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

function getterName(field: string, booleanPrimitive: boolean): string {
  return booleanPrimitive
    ? /^is[A-Z]/.test(field) ? field : `is${capitalize(field)}`
    : `get${capitalize(field)}`;
}

function setterName(field: string, booleanPrimitive: boolean): string {
  const base = booleanPrimitive && /^is[A-Z]/.test(field) ? field.slice(2) : field;
  return `set${capitalize(base)}`;
}

function fieldType(field: Node, line: string): string {
  const declaration = field.signature ?? line;
  const nameAt = declaration.lastIndexOf(field.name);
  const beforeName = declaration.slice(0, nameAt < 0 ? declaration.length : nameAt).trim();
  const withoutAnnotations = beforeName.replace(/@(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:\([^)]*\))?/g, ' ');
  const parts = withoutAnnotations.split(/\s+/).filter((part) => part && !FIELD_MODIFIERS.has(part));
  return parts.join(' ') || 'Object';
}

/** Adds the compile-time members promised by Lombok without a parser-backed Java AST. */
export function addNativeLombokFacts(filePath: string, source: string, result: ExtractionResult): ExtractionResult {
  if (!LOMBOK_ANNOTATION_RE.test(source)) return result;
  const lines = source.split(/\r?\n/);
  const containsBySource = new Map<string, string[]>();
  for (const edge of result.edges) {
    if (edge.kind !== 'contains') continue;
    const targets = containsBySource.get(edge.source) ?? [];
    targets.push(edge.target);
    containsBySource.set(edge.source, targets);
  }
  const byId = new Map(result.nodes.map((node) => [node.id, node]));

  for (const owner of result.nodes.filter((node) => node.kind === 'class')) {
    const classAnnotations = annotationsAt(lines, owner.startLine);
    const fields = (containsBySource.get(owner.id) ?? [])
      .map((id) => byId.get(id))
      .filter((node): node is Node => node?.kind === 'field');
    const hasAnnotatedField = fields.some((field) => {
      const anns = annotationsAt(lines, field.startLine);
      return anns.has('Getter') || anns.has('Setter');
    });
    const classGetter = classAnnotations.has('Getter');
    const classSetter = classAnnotations.has('Setter');
    const data = classAnnotations.has('Data');
    const value = classAnnotations.has('Value');
    const builder = classAnnotations.has('Builder') || classAnnotations.has('SuperBuilder');
    const toString = data || value || classAnnotations.has('ToString');
    const equals = data || value || classAnnotations.has('EqualsAndHashCode');
    const logAnnotation = [...classAnnotations].find((name) => LOG_ANNOTATIONS.has(name));
    if (!classGetter && !classSetter && !data && !value && !builder && !toString && !equals && !logAnnotation && !hasAnnotatedField) continue;

    const children = (containsBySource.get(owner.id) ?? []).map((id) => byId.get(id)).filter(Boolean) as Node[];
    const methodNames = new Set(children.filter((node) => node.kind === 'method' || node.kind === 'function').map((node) => node.name));
    const fieldNames = new Set(children.filter((node) => node.kind === 'field').map((node) => node.name));

    const emit = (kind: 'method' | 'field', name: string, anchor: Node, signature: string, annotation: string, extra: Partial<Node> = {}): void => {
      const taken = kind === 'method' ? methodNames : fieldNames;
      if (!name || taken.has(name)) return;
      taken.add(name);
      const node: Node = {
        id: generateNodeId(filePath, kind, name, anchor.startLine),
        kind,
        name,
        qualifiedName: `${owner.qualifiedName}::${name}`,
        filePath,
        language: 'java',
        startLine: anchor.startLine,
        endLine: anchor.endLine,
        startColumn: anchor.startColumn,
        endColumn: anchor.endColumn,
        visibility: kind === 'method' ? 'public' : 'private',
        signature,
        docstring: `Lombok-generated (${annotation})`,
        decorators: ['lombok'],
        updatedAt: Date.now(),
        ...extra,
      };
      result.nodes.push(node);
      result.edges.push({ source: owner.id, target: node.id, kind: 'contains' } as Edge);
      byId.set(node.id, node);
    };

    for (const field of fields) {
      const line = lines[field.startLine - 1] ?? '';
      if (field.isStatic || /\bstatic\b/.test(line)) continue;
      const annotations = annotationsAt(lines, field.startLine);
      const getter = classGetter || data || value || annotations.has('Getter');
      const setter = (classSetter || data || annotations.has('Setter')) && !/\bfinal\b/.test(line);
      if (!getter && !setter) continue;
      const type = fieldType(field, line);
      const isBoolean = type === 'boolean';
      if (getter) {
        const name = getterName(field.name, isBoolean);
        emit('method', name, field, `${type} ${name}()`, annotations.has('Getter') ? '@Getter' : data ? '@Data' : value ? '@Value' : '@Getter',
          { returnType: isBoolean || /^(?:byte|short|int|long|float|double|char|void)$/.test(type) ? undefined : type });
      }
      if (setter) {
        const name = setterName(field.name, isBoolean);
        emit('method', name, field, `void ${name}(${type} ${field.name})`, annotations.has('Setter') ? '@Setter' : data ? '@Data' : '@Setter');
      }
    }

    if (builder) emit('method', 'builder', owner, `static ${owner.name}.${owner.name}Builder builder()`, classAnnotations.has('SuperBuilder') ? '@SuperBuilder' : '@Builder', { isStatic: true, returnType: `${owner.name}Builder` });
    if (toString) emit('method', 'toString', owner, 'String toString()', data ? '@Data' : value ? '@Value' : '@ToString', { returnType: 'String' });
    if (equals) {
      const annotation = data ? '@Data' : value ? '@Value' : '@EqualsAndHashCode';
      emit('method', 'equals', owner, 'boolean equals(Object o)', annotation);
      emit('method', 'hashCode', owner, 'int hashCode()', annotation);
    }
    if (logAnnotation) emit('field', 'log', owner, 'Logger log', `@${logAnnotation}`, { isStatic: true });
  }

  result.nodes.sort((left, right) => left.startLine - right.startLine || left.startColumn - right.startColumn || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
  return result;
}
