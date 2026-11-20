/**
 * AFYX-native Terraform / OpenTofu Intelligence Extractor (AFYX-210).
 *
 * Provides static extraction for Terraform and OpenTofu files (.tf, .tofu, .tfvars):
 * - Resources, data sources, modules, outputs, variables, locals, providers
 * - Inter-resource `depends_on` relationships
 * - Secret-safe handling for sensitive variables and credentials
 */

import * as path from 'path';
import type { ExtractionResult } from '../types';
import { extractNativeTerraformFacts } from './native/terraform-facts';

export function isTerraformFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.tf' || ext === '.tofu' || ext === '.tfvars';
}

export class TerraformExtractor {
  private filePath: string;
  private source: string;

  constructor(filePath: string, source: string) {
    this.filePath = filePath;
    this.source = source;
  }

  extract(): ExtractionResult {
    return extractNativeTerraformFacts(this.filePath, this.source);
  }
}
