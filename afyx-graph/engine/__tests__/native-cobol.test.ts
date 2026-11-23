import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { extractNativeCobolFacts, scanCobolSource } from '../src/extraction/native/cobol-facts';
import { tokenizeSource } from '../src/extraction/syntax-tokens';
import { extractFromSource } from '../src/extraction/extract';

const FIXED = (body: string) => body.split('\n').map((line) => line ? `       ${line}` : line).join('\n');
const SOURCE = FIXED(`IDENTIFICATION DIVISION.
PROGRAM-ID. NATIVEPROG.
DATA DIVISION.
WORKING-STORAGE SECTION.
01  WS-GROUP.
    05  WS-COUNT PIC 9(4) VALUE ZERO.
    05  WS-ALT REDEFINES WS-COUNT PIC X(4).
    88  WS-DONE VALUE 'Y'.
01  WS-TRANID PIC X(4) VALUE 'CB00'.
COPY COMMON-REC.
PROCEDURE DIVISION.
MAIN-SECTION SECTION.
START-HERE.
    PERFORM INIT-PARA
    PERFORM WORK-PARA THRU WORK-EXIT
    CALL 'SUBPROG'
    CALL WS-DYNAMIC
    GO TO DONE-PARA.
INIT-PARA.
    MOVE ZERO TO WS-COUNT.
WORK-PARA.
    EXEC CICS LINK PROGRAM('CICSPROG') END-EXEC.
WORK-EXIT.
    EXEC CICS RETURN TRANSID(WS-TRANID) END-EXEC.
DONE-PARA.
    GOBACK.
`);

function semantic(result: ReturnType<typeof extractFromSource>) {
  const owner = new Map(result.nodes.map((node) => [node.id, `${node.kind}:${node.qualifiedName}`]));
  return {
    nodes: result.nodes.filter((node) => node.kind !== 'file').map((node) => ({
      kind: node.kind, name: node.name, qualifiedName: node.qualifiedName,
      signature: node.signature,
    })).sort((left, right) => `${left.kind}:${left.qualifiedName}`.localeCompare(`${right.kind}:${right.qualifiedName}`)),
    refs: result.unresolvedReferences.map((reference) => ({
      owner: owner.get(reference.fromNodeId), kind: reference.referenceKind, name: reference.referenceName,
    })).sort((left, right) => `${left.owner}|${left.kind}|${left.name}`.localeCompare(`${right.owner}|${right.kind}|${right.name}`)),
  };
}

describe('Afyx-native COBOL facts', () => {

  afterEach(() => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
  });

  it('preserves the representative parser-backed semantic contract', () => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
    const oldResult = extractFromSource('NATIVEPROG.cbl', SOURCE, 'cobol');
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const newResult = extractFromSource('NATIVEPROG.cbl', SOURCE, 'cobol');
    expect(semantic(newResult)).toEqual(semantic(oldResult));
  });

  it('routes native-gated facts without requesting Tree-sitter', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const result = extractFromSource('NATIVEPROG.cbl', SOURCE, 'cobol');
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'module', name: 'NATIVEPROG' }),
      expect.objectContaining({ kind: 'function', name: 'START-HERE' }),
      expect.objectContaining({ kind: 'field', name: 'WS-COUNT' }),
      expect.objectContaining({ kind: 'field', name: 'WS-ALT', signature: expect.stringContaining('REDEFINES WS-COUNT') }),
      expect.objectContaining({ kind: 'constant', name: 'WS-DONE' }),
    ]));
  });

  it('classifies fixed/free syntax and comments natively without requesting Tree-sitter', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = "000100 IDENTIFICATION DIVISION.\n000200 PROGRAM-ID. DEMO.\n000300* fixed comment\n       MOVE 'x' TO WS-X *> inline";
    const result = await tokenizeSource(source, 'cobol');
    const values = (cls: string) => (result?.spans ?? []).filter((span) => span.cls === cls)
      .map((span) => source.slice(span.start, span.end));
    expect(values('keyword')).toEqual(expect.arrayContaining(['IDENTIFICATION', 'DIVISION', 'PROGRAM-ID', 'MOVE', 'TO']));
    expect(values('string')).toContain("'x'");
    expect(values('comment')).toEqual(expect.arrayContaining(['* fixed comment', '*> inline']));
  });

  it('retains parser-visible literals and identifiers while adding bounded keyword coverage', async () => {
    const source = FIXED("IDENTIFICATION DIVISION.\nPROGRAM-ID. DEMO.\nPROCEDURE DIVISION.\nRUN.\n    MOVE 'x' TO WS-X.");
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
    const oldResult = await tokenizeSource(source, 'cobol');
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const newResult = await tokenizeSource(source, 'cobol');
    const classes = (result: Awaited<ReturnType<typeof tokenizeSource>>) => (result?.spans ?? []).map((span) => {
      const text = source.slice(span.start, span.end);
      return [span.cls === 'def' ? 'ident' : span.cls, text];
    });
    const oldClasses = classes(oldResult);
    const newClasses = classes(newResult);
    for (const pair of oldClasses.filter(([cls]) => cls === 'ident' || cls === 'string')) {
      expect(newClasses).toContainEqual(pair);
    }
    expect(newClasses).toEqual(expect.arrayContaining([
      ['keyword', 'IDENTIFICATION'], ['keyword', 'PROCEDURE'], ['keyword', 'MOVE'],
    ]));
    expect((newResult?.spans ?? []).filter((span) => span.cls === 'def').map((span) => source.slice(span.start, span.end)))
      .toEqual(expect.arrayContaining(['DEMO', 'RUN']));
  });

  it('keeps original free-format coordinates and skips dynamic CALL targets', () => {
    const source = "IDENTIFICATION DIVISION.\nPROGRAM-ID. FREEPROG.\nPROCEDURE DIVISION.\nRUN.\n  CALL TARGET-NAME\n  CALL 'STATIC-PROG'.";
    const result = extractNativeCobolFacts('free.cbl', source);
    expect(result.nodes.find((node) => node.name === 'FREEPROG')).toEqual(expect.objectContaining({ startLine: 2, startColumn: 12 }));
    expect(result.unresolvedReferences.map((reference) => reference.referenceName)).toContain('STATIC-PROG');
    expect(result.unresolvedReferences.map((reference) => reference.referenceName)).not.toContain('TARGET-NAME');
  });

  it('joins fixed-format continuation lines without losing source coordinates', () => {
    const source = [
      '000100 IDENTIFICATION DIVISION.',
      '000200 PROGRAM-ID. CONTINUE-DEMO.',
      '000300 PROCEDURE DIVISION.',
      '000400 RUN.',
      '000500     PERFORM FIRST-PARA',
      '000600-       THRU LAST-PARA',
      '000700 FIRST-PARA.',
      '000800     CONTINUE.',
      '000900 LAST-PARA.',
      '001000     GOBACK.',
    ].join('\n');
    const result = extractNativeCobolFacts('continue.cbl', source);
    const calls = result.unresolvedReferences.filter((reference) => reference.referenceKind === 'calls');
    expect(calls.map((reference) => reference.referenceName)).toEqual(expect.arrayContaining(['FIRST-PARA', 'LAST-PARA']));
    expect(calls.find((reference) => reference.referenceName === 'LAST-PARA')).toEqual(expect.objectContaining({ line: 6 }));
  });

  it('retains prefix facts and a bounded diagnostic for incomplete source', () => {
    const source = "IDENTIFICATION DIVISION.\nPROGRAM-ID. PARTIAL.\nPROCEDURE DIVISION.\nRUN.\n  DISPLAY 'open";
    expect(scanCobolSource(source).unterminated).toContain('string');
    const result = extractNativeCobolFacts('partial.cbl', source);
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'module', name: 'PARTIAL' }),
      expect.objectContaining({ kind: 'function', name: 'RUN' }),
    ]));
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'native_incomplete_source' }),
    ]));
  });
});
