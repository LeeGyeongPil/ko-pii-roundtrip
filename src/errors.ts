// 이 라이브러리가 던지는 예외. 공통 부모 KoPiiError 하나만 잡으면 된다.

export class KoPiiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KoPiiError';
  }
}

/** detect 옵션에 모르는 탐지기 이름을 넣었을 때 */
export class UnknownDetectorError extends KoPiiError {
  readonly detector: string;
  constructor(detector: string, known: readonly string[]) {
    super(`알 수 없는 탐지기 '${detector}'. 쓸 수 있는 이름: ${known.join(', ')}`);
    this.name = 'UnknownDetectorError';
    this.detector = detector;
  }
}
