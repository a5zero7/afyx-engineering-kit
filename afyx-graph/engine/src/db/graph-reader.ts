/**
 * The read side of the graph database.
 *
 * `GraphReader` composes the per-responsibility readers over one `QuerySession`:
 * `NodeReader` (identity, name/kind/file lookup, the row cache), `EdgeReader` (outgoing/
 * incoming), `FileReader` (file records and the generated/ambient flags), `ReferenceReader`
 * (unresolved refs), `DependencyReader` (file-level and blast-radius aggregates),
 * `RoutingReader` (project-shape heuristics), `VocabularyReader` (name-segment reads),
 * `SearchReader` (FTS/LIKE/fuzzy search) and `StatsReader` (counts and metadata).
 * `QueryBuilder` is the compatibility facade in front of this plus `GraphWriter`.
 */

import { DependencyReader } from './dependency-reader';
import { EdgeReader } from './edge-reader';
import { FileReader } from './file-reader';
import { NodeReader } from './node-reader';
import { QuerySession } from './query-session';
import { ReferenceReader } from './reference-reader';
import { RoutingReader } from './routing-reader';
import { SearchReader } from './search-reader';
import type { SqliteDatabase } from './sqlite-adapter';
import { StatsReader } from './stats-reader';
import { VocabularyReader } from './vocabulary-reader';

export class GraphReader {
  private readonly session: QuerySession;
  readonly nodes: NodeReader;
  readonly edges: EdgeReader;
  readonly files: FileReader;
  readonly refs: ReferenceReader;
  readonly dependencies: DependencyReader;
  readonly routing: RoutingReader;
  readonly vocabulary: VocabularyReader;
  readonly search: SearchReader;
  readonly stats: StatsReader;

  constructor(db: SqliteDatabase) {
    this.session = new QuerySession(db);
    this.nodes = new NodeReader(this.session);
    this.edges = new EdgeReader(this.session);
    this.files = new FileReader(this.session);
    this.refs = new ReferenceReader(this.session);
    this.dependencies = new DependencyReader(this.session);
    this.routing = new RoutingReader(this.session, this.files);
    this.vocabulary = new VocabularyReader(this.session);
    this.search = new SearchReader(this.session, this.nodes);
    this.stats = new StatsReader(this.session);
  }

  /** Follow the connection swap: every prepared statement resets, cache and vocabulary/search state do not. */
  rebind(db: SqliteDatabase): void {
    this.session.rebind(db);
  }
}
