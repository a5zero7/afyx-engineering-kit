import type { ExtractionResult, Language } from '../types';
import { extractFromSource } from './extract';
import { detectLanguage, isLanguageSupported } from './grammars';

/**
 * Afyx-native parser dispatch boundary.
 *
 * Language selection and extraction used to be repeated at each orchestration
 * call site. Keeping both decisions here prevents full extraction, scoped
 * extraction, and single-file extraction from selecting different adapters.
 */
export class ExtractorRegistry {
  constructor(
    private readonly extensionOverrides: Readonly<Record<string, Language>> = {},
    private readonly frameworkNames: readonly string[] = [],
  ) {}

  languageFor(filePath: string, content: string): Language {
    return detectLanguage(filePath, content, this.extensionOverrides);
  }

  supports(filePath: string, content: string): boolean {
    return isLanguageSupported(this.languageFor(filePath, content));
  }

  extract(filePath: string, content: string): ExtractionResult {
    const language = this.languageFor(filePath, content);
    if (!isLanguageSupported(language)) {
      return { nodes: [], edges: [], unresolvedReferences: [], errors: [], durationMs: 0 };
    }
    return extractFromSource(filePath, content, language, [...this.frameworkNames]);
  }
}
