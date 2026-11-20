/** Afyx-native production extraction dispatch. */

import * as path from 'path';
import type { ExtractionResult, Language } from '../types';
import { detectLanguage, isFileLevelOnlyLanguage } from './grammars';
import { LiquidExtractor } from './liquid-extractor';
import { RazorExtractor } from './razor-extractor';
import { SvelteExtractor } from './svelte-extractor';
import { AstroExtractor } from './astro-extractor';
import { DfmExtractor } from './dfm-extractor';
import { VueExtractor } from './vue-extractor';
import { MyBatisExtractor } from './mybatis-extractor';
import {
  OdooManifestExtractor,
  OdooAccessCsvExtractor,
  OdooSecurityXmlExtractor,
  isOdooManifest,
  isOdooAccessCsv,
  isOdooXml,
} from './odoo';
import { extractNativeFacts } from './native/fact-extractor';
import { extractNativeCfmlFacts } from './native/cfml-facts';
import { extractNativeShellFacts } from './native/shell-facts';
import { extractNativePowerShellFacts } from './native/powershell-facts';
import { getAllFrameworkResolvers, getApplicableFrameworks } from '../resolution/frameworks';
import { ConfigExtractor, isConfigFile } from './config-extractor';
import { DockerExtractor, isDockerRelatedFile } from './docker-extractor';
import { CicdExtractor, isCicdFile } from './cicd-extractor';
import { SqlExtractor, isSqlFile } from './sql-extractor';
import { OpenApiExtractor, isOpenApiFile } from './openapi-extractor';
import { GraphQLExtractor, isGraphQLFile } from './graphql-extractor';
import { ProtobufExtractor, isProtobufFile } from './protobuf-extractor';
import { KubernetesExtractor, isKubernetesFile } from './k8s-extractor';
import { TerraformExtractor, isTerraformFile } from './terraform-extractor';

const NATIVE_FACT_LANGUAGES: ReadonlySet<Language> = new Set([
  'typescript', 'tsx', 'javascript', 'jsx', 'arkts', 'python', 'go', 'java',
  'rust', 'kotlin', 'scala', 'c', 'cpp', 'objc', 'csharp', 'swift', 'solidity',
  'php', 'ruby', 'lua', 'luau', 'r', 'dart', 'nix', 'pascal', 'vbnet', 'erlang',
  'terraform', 'cobol',
]);

export function extractFromSource(
  filePath: string,
  source: string,
  language?: Language,
  frameworkNames?: string[],
): ExtractionResult {
  const detectedLanguage = language || detectLanguage(filePath, source);
  const fileExtension = path.extname(filePath).toLowerCase();
  let result: ExtractionResult;

  if (isOpenApiFile(filePath, source)) {
    result = new OpenApiExtractor(filePath, source).extract();
  } else if (isCicdFile(filePath)) {
    result = new CicdExtractor(filePath, source).extract();
  } else if (isDockerRelatedFile(filePath)) {
    result = new DockerExtractor(filePath, source).extract();
  } else if (isKubernetesFile(filePath, source)) {
    result = new KubernetesExtractor(filePath, source).extract();
  } else if (isGraphQLFile(filePath)) {
    result = new GraphQLExtractor(filePath, source).extract();
  } else if (isProtobufFile(filePath)) {
    result = new ProtobufExtractor(filePath, source).extract();
  } else if (isSqlFile(filePath)) {
    result = new SqlExtractor(filePath, source).extract();
  } else if (isConfigFile(filePath)) {
    result = new ConfigExtractor(filePath, source).extract();
  } else if (isTerraformFile(filePath)) {
    result = new TerraformExtractor(filePath, source).extract();
  } else if (detectedLanguage === 'shell') {
    result = extractNativeShellFacts(filePath, source);
  } else if (detectedLanguage === 'powershell') {
    result = extractNativePowerShellFacts(filePath, source);
  } else if (detectedLanguage === 'cfml' || detectedLanguage === 'cfscript' || detectedLanguage === 'cfquery') {
    result = extractNativeCfmlFacts(filePath, source, detectedLanguage);
  } else if (detectedLanguage === 'csv' || isOdooAccessCsv(filePath)) {
    result = new OdooAccessCsvExtractor(filePath, source).extract();
  } else if (
    NATIVE_FACT_LANGUAGES.has(detectedLanguage) &&
    !(detectedLanguage === 'pascal' && (fileExtension === '.dfm' || fileExtension === '.fmx'))
  ) {
    if (detectedLanguage === 'python' && isOdooManifest(filePath)) {
      result = new OdooManifestExtractor(filePath, source).extract();
    } else {
      result = extractNativeFacts(filePath, source, detectedLanguage);
    }
  } else if (detectedLanguage === 'svelte') {
    result = new SvelteExtractor(filePath, source).extract();
  } else if (detectedLanguage === 'vue') {
    result = new VueExtractor(filePath, source).extract();
  } else if (detectedLanguage === 'astro') {
    result = new AstroExtractor(filePath, source).extract();
  } else if (detectedLanguage === 'liquid') {
    result = new LiquidExtractor(filePath, source).extract();
  } else if (detectedLanguage === 'razor') {
    result = new RazorExtractor(filePath, source).extract();
  } else if (detectedLanguage === 'xml') {
    if (isOdooXml(source, filePath)) {
      result = new OdooSecurityXmlExtractor(filePath, source).extract();
    } else {
      result = new MyBatisExtractor(filePath, source).extract();
    }
  } else if (isFileLevelOnlyLanguage(detectedLanguage)) {
    result = { nodes: [], edges: [], unresolvedReferences: [], errors: [], durationMs: 0 };
  } else if (
    detectedLanguage === 'pascal' &&
    (fileExtension === '.dfm' || fileExtension === '.fmx')
  ) {
    result = new DfmExtractor(filePath, source).extract();
  } else {
    result = {
      nodes: [], edges: [], unresolvedReferences: [],
      errors: [{
        message: `Unsupported language: ${detectedLanguage}`,
        filePath,
        severity: 'error',
        code: 'unsupported_language',
      }],
      durationMs: 0,
    };
  }

  if (frameworkNames && frameworkNames.length > 0) {
    const applicable = getApplicableFrameworks(
      getAllFrameworkResolvers().filter((resolver) => frameworkNames.includes(resolver.name)),
      detectedLanguage,
    );
    for (const framework of applicable) {
      if (!framework.extract) continue;
      try {
        const frameworkResult = framework.extract(filePath, source);
        result.nodes.push(...frameworkResult.nodes);
        result.unresolvedReferences.push(...frameworkResult.references);
      } catch (error) {
        result.errors.push({
          message: `Framework extractor '${framework.name}' failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          filePath,
          severity: 'warning',
        });
      }
    }
  }

  return result;
}
