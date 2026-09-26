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

  /** i 번 원소의 키가 (a, b, c) 보다 작으면 음수, 크면 양수 */
  private cmp(i: number, a: number, b: number, c: number) {
    return this.a[i] - a || this.b[i] - b || this.c[i] - c;
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
