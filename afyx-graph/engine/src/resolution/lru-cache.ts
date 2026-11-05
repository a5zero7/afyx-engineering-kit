/**
 * AFYX Engineering Kit - Bound Least-Recently-Used (LRU) Cache
 *
 * Provides a bounded memory cache leveraging Map insertion order semantics
 * to evict stale entries under high node counts and protect against out-of-memory states.
 */

export class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly storage = new Map<K, V>();

  constructor(maxEntries: number) {
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
      throw new Error(`LRUCache capacity must be a positive integer, received: ${maxEntries}`);
    }
    this.capacity = Math.floor(maxEntries);
  }

  get size(): number {
    return this.storage.size;
  }

  get(key: K): V | undefined {
    if (!this.storage.has(key)) {
      return undefined;
    }
    const val = this.storage.get(key) as V;
    // Move key to the end of iteration order by re-inserting
    this.storage.delete(key);
    this.storage.set(key, val);
    return val;
  }

  has(key: K): boolean {
    return this.storage.has(key);
  }

  set(key: K, value: V): void {
    if (this.storage.has(key)) {
      this.storage.delete(key);
    } else if (this.storage.size >= this.capacity) {
      const oldestKey = this.storage.keys().next().value;
      if (oldestKey !== undefined) {
        this.storage.delete(oldestKey);
      }
    }
    this.storage.set(key, value);
  }

  clear(): void {
    this.storage.clear();
  }
}
