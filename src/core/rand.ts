/** Microsoft Visual C++ rand(): the generator BALLS.EXE uses for effects. */
export class MsvcRand {
  private state: number;

  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }

  /** (rand() - rand()) / 32767, the engine's usual symmetric noise in [-1, 1]. */
  noise(): number {
    const a = this.next();
    const b = this.next();
    return (a - b) * (1 / 32767);
  }
}
