import type { Language } from '../../types';
import { preParseCSource, preParseCppSource } from './c-cpp';
import { blankCsharpPreprocessorDirectives } from './csharp';
import { preParseCobolSource } from './cobol';
import { ensureTrailingNewline } from './vbnet';

export type SourcePreprocessor = (source: string, filePath?: string) => string;

/** Native grammar input normalization retained after parser-adapter removal. */
export const SOURCE_PREPROCESSORS: Partial<Record<Language, SourcePreprocessor>> = {
  c: preParseCSource,
  cpp: preParseCppSource,
  csharp: blankCsharpPreprocessorDirectives,
  cobol: preParseCobolSource,
  vbnet: ensureTrailingNewline,
};

export function preProcessSource(
  filePath: string,
  source: string,
  language: Language
): string {
  const preprocessor = SOURCE_PREPROCESSORS[language];
  return preprocessor ? preprocessor(source, filePath) : source;
}
