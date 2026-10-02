/** Deterministic lexicographic heap; duplicate entries are invalidated by callers. */
export interface QueueEntry { node: number; first: number; second: number; version?: number }
export class ResearchQueue {
  private items: QueueEntry[] = [];
  get size() { return this.items.length; }
  peek() { return this.items[0]; }
  private less(a: QueueEntry, b: QueueEntry) {
    return a.first < b.first || (a.first === b.first && (a.second < b.second || (a.second === b.second && a.node < b.node)));
  }
  push(entry: QueueEntry) {
    let i = this.items.length;
    this.items.push(entry);
    while (i > 0) {
      const p = (i - 1) >>> 1;
      if (!this.less(entry, this.items[p])) break;
      this.items[i] = this.items[p]; i = p;
    }
    this.items[i] = entry;
  }
  pop(): QueueEntry {
    const first = this.items[0], last = this.items.pop()!;
    if (!this.items.length) return first;
    let i = 0;
    while (i * 2 + 1 < this.items.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.items.length && this.less(this.items[child + 1], this.items[child])) child++;
      if (!this.less(this.items[child], last)) break;
      this.items[i] = this.items[child]; i = child;
    }
    this.items[i] = last;
    return first;
  }
}

export function lessKey(a: [number, number], b: [number, number]) {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}
