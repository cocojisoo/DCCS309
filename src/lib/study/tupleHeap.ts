/**
 * 키가 (a, b, c) 세 숫자인 이진 최소 힙. a 가 같으면 b, b 도 같으면 c 로 비교한다.
 * 다익스트라: (거리, 순번, 0) / A*: (거리 + 힌트, −거리, 순번)
 */
export class TupleHeap {
  private a: number[] = [];
  private b: number[] = [];
  private c: number[] = [];
  private v: number[] = [];

  get size() {
    return this.v.length;
  }

  /** 맨 위 원소의 키와 값 (비어 있으면 키는 Infinity) */
  topA() {
    return this.v.length ? this.a[0] : Infinity;
  }
  topB() {
    return this.v.length ? this.b[0] : Infinity;
  }
  topC() {
    return this.v.length ? this.c[0] : Infinity;
  }
  topValue() {
    return this.v[0];
  }

  /** i 번 원소의 키가 (a, b, c) 보다 작으면 음수, 크면 양수 */
  private cmp(i: number, a: number, b: number, c: number) {
    // 뺄셈 대신 비교를 써서 Infinity 끼리도 올바르게 비교한다
    const A = this.a[i];
    if (A !== a) return A < a ? -1 : 1;
    const B = this.b[i];
    if (B !== b) return B < b ? -1 : 1;
    const C = this.c[i];
    return C < c ? -1 : C > c ? 1 : 0;
  }

  private set(i: number, a: number, b: number, c: number, v: number) {
    this.a[i] = a;
    this.b[i] = b;
    this.c[i] = c;
    this.v[i] = v;
  }

  private move(to: number, from: number) {
    this.set(to, this.a[from], this.b[from], this.c[from], this.v[from]);
  }

  push(a: number, b: number, c: number, value: number) {
    let i = this.v.length;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cmp(p, a, b, c) <= 0) break;
      this.move(i, p);
      i = p;
    }
    this.set(i, a, b, c, value);
  }

  pop(): number {
    const top = this.v[0];
    const la = this.a.pop()!;
    const lb = this.b.pop()!;
    const lc = this.c.pop()!;
    const lv = this.v.pop()!;
    const n = this.v.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let ch = 2 * i + 1;
        if (ch >= n) break;
        if (ch + 1 < n && this.cmp(ch + 1, this.a[ch], this.b[ch], this.c[ch]) < 0) ch++;
        if (this.cmp(ch, la, lb, lc) >= 0) break;
        this.move(i, ch);
        i = ch;
      }
      this.set(i, la, lb, lc, lv);
    }
    return top;
  }
}
