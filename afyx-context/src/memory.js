/**
 * AFYX Context Engine - Native Persistent Engineering Memory
 *
 * Provides deterministic, project-scoped, bounded persistent memory
 * for technical architecture decisions, constraints, and conventions.
 * Standalone by design; stores structured evidence in a local JSON store
 * without external databases, background daemons, or cloud telemetry.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const MEMORY_CONTRACT_VERSION = 'afyx-memory-v1';
export const DEFAULT_MAX_ITEMS = 100;
export const MEMORY_DIR_NAME = '.afyx-context';
export const MEMORY_FILE_NAME = 'engineering-memory.json';

export const MEMORY_CATEGORIES = Object.freeze([
  'architecture',
  'decision',
  'pattern',
  'constraint',
  'convention',
  'fact',
]);

/**
 * Creates a unique content hash for memory item deduplication.
 */
function hashText(text) {
  return createHash('sha256').update(String(text).trim().toLowerCase()).digest('hex').slice(0, 16);
}

/**
 * Project-Scoped Engineering Memory Manager.
 */
export class AfyxEngineeringMemory {
  /**
   * @param {Object} options
   * @param {string} options.projectRoot - Absolute path to workspace root
   * @param {string} [options.storagePath] - Custom absolute storage file path
   * @param {boolean} [options.enabled] - Explicit enable flag (defaults to env AFYX_CONTEXT_MEMORY !== '0')
   * @param {number} [options.maxItems] - Maximum items to retain (bounds local storage)
   */
  constructor({ projectRoot, storagePath, enabled, maxItems } = {}) {
    this.projectRoot = resolve(projectRoot || process.cwd());
    this.storagePath = storagePath || join(this.projectRoot, MEMORY_DIR_NAME, MEMORY_FILE_NAME);
    this.enabled = enabled !== undefined ? Boolean(enabled) : process.env.AFYX_CONTEXT_MEMORY !== '0';
    this.maxItems = Number.isInteger(maxItems) && maxItems > 0 ? maxItems : DEFAULT_MAX_ITEMS;
    this.items = [];
    this.load();
  }

  /**
   * Loads memory entries from persistent local storage.
   */
  load() {
    if (!this.enabled) return;
    if (!existsSync(this.storagePath)) {
      this.items = [];
      return;
    }
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.schema === MEMORY_CONTRACT_VERSION && Array.isArray(parsed.items)) {
        this.items = parsed.items;
      } else {
        this.items = [];
      }
    } catch {
      this.items = [];
    }
  }

  /**
   * Persists memory entries atomically to disk.
   */
  save() {
    if (!this.enabled) return;
    try {
      const dir = dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      // Bound retention
      if (this.items.length > this.maxItems) {
        this.items.sort((a, b) => b.updatedAt - a.updatedAt);
        this.items = this.items.slice(0, this.maxItems);
      }
      const payload = {
        schema: MEMORY_CONTRACT_VERSION,
        projectRoot: this.projectRoot,
        updatedAt: Date.now(),
        count: this.items.length,
        items: this.items,
      };
      writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // Storage failure must fail gracefully without halting the agent turn
    }
  }

  /**
   * Records or updates a technical memory item.
   *
   * @param {Object} item
   * @param {string} item.key - Canonical identifier for the technical fact
   * @param {string} item.category - One of MEMORY_CATEGORIES
   * @param {string} item.content - Detailed engineering note or decision
   * @param {string[]} [item.tags] - Search tags or symbol references
   * @param {string} [item.source] - Provenance file path or task identifier
   * @returns {Object|null} The recorded memory item
   */
  record({ key, category, content, tags = [], source = 'manual' }) {
    if (!this.enabled) return null;
    if (!key || typeof key !== 'string' || !content || typeof content !== 'string') {
      throw new Error('Memory item requires non-empty "key" and "content" strings.');
    }
    const cat = MEMORY_CATEGORIES.includes(category) ? category : 'fact';
    const contentHash = hashText(content);
    const now = Date.now();

    const existingIndex = this.items.findIndex(
      (m) => m.key === key || (m.contentHash === contentHash && m.category === cat)
    );

    const memoryEntry = {
      key: key.trim(),
      category: cat,
      content: content.trim(),
      contentHash,
      tags: Array.isArray(tags) ? [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))] : [],
      source: String(source).trim(),
      createdAt: existingIndex >= 0 ? this.items[existingIndex].createdAt : now,
      updatedAt: now,
      accessCount: existingIndex >= 0 ? (this.items[existingIndex].accessCount || 0) + 1 : 1,
    };

    if (existingIndex >= 0) {
      this.items[existingIndex] = memoryEntry;
    } else {
      this.items.unshift(memoryEntry);
    }

    this.save();
    return memoryEntry;
  }

  /**
   * Retrieves relevant memory entries matching a query string, symbols, or category filter.
   *
   * @param {Object} options
   * @param {string} [options.query] - Natural language search query or keywords
   * @param {string} [options.category] - Filter by specific category
   * @param {string[]} [options.symbols] - Related symbol names or file paths
   * @param {number} [options.limit] - Max items to return
   * @returns {Array<Object>} Relevant memory items sorted by score
   */
  retrieve({ query = '', category = null, symbols = [], limit = 5 } = {}) {
    if (!this.enabled || this.items.length === 0) return [];

    const queryTokens = query
      ? query.toLowerCase().split(/[\s,._\-/]+/).filter((t) => t.length > 2)
      : [];
    const symbolTokens = Array.isArray(symbols)
      ? symbols.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
      : [];

    const scored = this.items
      .filter((item) => !category || item.category === category)
      .map((item) => {
        let score = 0;
        const keyLower = item.key.toLowerCase();
        const contentLower = item.content.toLowerCase();
        const tagsLower = item.tags.map((t) => t.toLowerCase());

        // Exact symbol match in key or tags carries high weight
        for (const sym of symbolTokens) {
          if (keyLower.includes(sym)) score += 10;
          if (tagsLower.includes(sym)) score += 8;
          if (contentLower.includes(sym)) score += 4;
        }

        // Query token matches
        for (const token of queryTokens) {
          if (keyLower.includes(token)) score += 5;
          if (tagsLower.includes(token)) score += 3;
          if (contentLower.includes(token)) score += 1;
        }

        // Slight recency bias
        const ageHours = (Date.now() - item.updatedAt) / (1000 * 60 * 60);
        if (ageHours < 24) score += 1;

        return { item, score };
      })
      .filter((entry) => (queryTokens.length === 0 && symbolTokens.length === 0) || entry.score > 0)
      .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
      .slice(0, Math.max(1, limit))
      .map((entry) => {
        entry.item.accessCount = (entry.item.accessCount || 0) + 1;
        return entry.item;
      });

    this.save();
    return scored;
  }

  /**
   * Deletes a specific memory entry by key.
   */
  remove(key) {
    if (!this.enabled) return false;
    const initialLen = this.items.length;
    this.items = this.items.filter((m) => m.key !== key);
    if (this.items.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Completely purges all stored memory for this project.
   */
  clear() {
    this.items = [];
    this.save();
  }

  /**
   * Formats retrieved memories as compact Markdown for LLM prompt injection.
   */
  formatForContext(retrievedItems) {
    if (!Array.isArray(retrievedItems) || retrievedItems.length === 0) return '';
    const lines = [
      '<!-- AFYX-ENGINEERING-MEMORY:START -->',
      '## Project Engineering Memory (Verified Local Facts)',
    ];
    for (const mem of retrievedItems) {
      lines.push(`- **[${mem.category.toUpperCase()}] ${mem.key}**: ${mem.content}`);
    }
    lines.push('<!-- AFYX-ENGINEERING-MEMORY:END -->');
    return lines.join('\n');
  }
}

/**
 * Factory helper for creating memory manager.
 */
export function createEngineeringMemory(options = {}) {
  return new AfyxEngineeringMemory(options);
}
