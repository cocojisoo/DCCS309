/** 우선순위 큐 (이진 최소 힙). 같은 노드를 여러 번 넣는 lazy deletion 방식으로 사용한다. */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size() {
    return this.keys.length;
  }

  push(key: number, val: number) {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }

  peekKey(): number {
    return this.keys.length ? this.keys[0] : Infinity;
  }

  /** 최소 원소의 값을 꺼낸다. 꺼낸 원소의 키는 lastKey 에 남는다. */
  lastKey = Infinity;
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const topKey = k[0];
    const topVal = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    this.lastKey = topKey;
    return topVal;
  }
}
