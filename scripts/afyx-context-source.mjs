// Copyright (c) 2026 Afyx
import { existsSync } from 'node:fs';

// The installed bridge stages these same AFYX sources inside its owned bundle.
const bundled = new URL('./afyx-context/src/', import.meta.url);
const source = existsSync(bundled) ? bundled : new URL('../afyx-context/src/', import.meta.url);
const [lineage, context] = await Promise.all([
  import(new URL('artifact-lineage.js', source)),
  import(new URL('massive-context.js', source)),
]);

export const { createArtifactLineage, sha256Bytes } = lineage;
export const { parseDelimitedRows, readStructuredDocument } = context;
