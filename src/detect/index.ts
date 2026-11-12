// 탐지기 실행과 겹침 해소.

import { UnknownDetectorError } from '../errors';
import { assertDetectOptions, assertText } from '../validate';
import type { Confidence, DetectOptions, Detection, Detector, PiiKind } from '../types';
import { accountDetector } from './account';
import { brnDetector } from './brn';
import { cardDetector } from './card';
import { emailDetector } from './email';
import { createNameDetector, nameDetector } from './name';
import { phoneDetector } from './phone';
import { frnDetector, rrnDetector } from './rrn';

/** 기본 탐지기 8종 */
export const detectors: Readonly<Record<PiiKind, Detector>> = {
  rrn: rrnDetector,
  frn: frnDetector,
  brn: brnDetector,
  phone: phoneDetector,
  card: cardDetector,
  account: accountDetector,
  email: emailDetector,
  name: nameDetector,
};

const BUILTIN_KINDS = Object.keys(detectors) as PiiKind[];

/** 탐지 결과 + 가명에 쓸 라벨(사용자 정의 탐지기만 라벨을 넘긴다) */
export interface LabeledDetection extends Detection {
  label?: string;
}

/** 옵션을 실제 탐지기 목록으로 바꾼다. 모르는 이름이면 UnknownDetectorError */
export function resolveDetectors(opts: DetectOptions = {}): Array<{ detector: Detector; builtin: boolean }> {
  const wanted = opts.detectors ?? BUILTIN_KINDS;
  return wanted.map((d) => {
    if (typeof d !== 'string') return { detector: d, builtin: false };
    if (!Object.hasOwn(detectors, d)) throw new UnknownDetectorError(String(d), BUILTIN_KINDS);
    if (d === 'name' && opts.names !== undefined && opts.names.length > 0) {
      return { detector: createNameDetector(opts.names), builtin: true };
    }
    return { detector: detectors[d], builtin: true };
  });
}

const RANK: Record<Confidence, number> = { checksum: 3, format: 2, context: 1 };

/**
 * 겹치는 탐지 결과 중 하나만 남긴다: 긴 것 → 신뢰도 높은 것 → 앞에 있는 것 순으로 우선.
 * 결과는 시작 위치 순.
 */
export function resolveOverlaps<T extends Detection>(found: readonly T[], taken: Array<[number, number]> = []): T[] {
  const ordered = [...found].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || RANK[b.confidence] - RANK[a.confidence] || a.start - b.start,
  );
  const kept: T[] = [];
  const spans = [...taken];
  for (const d of ordered) {
    if (d.end <= d.start) continue;
    if (spans.some(([s, e]) => d.start < e && s < d.end)) continue;
    spans.push([d.start, d.end]);
    kept.push(d);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** 내부용: 라벨까지 붙인 탐지 결과(겹침 해소 전) */
export function detectRaw(text: string, opts: DetectOptions = {}): LabeledDetection[] {
  const all: LabeledDetection[] = [];
  for (const { detector, builtin } of resolveDetectors(opts)) {
    for (const d of detector.find(text)) {
      all.push(builtin ? d : { ...d, label: detector.label });
    }
  }
  return all;
}

/**
 * 글에서 개인정보를 찾는다. 겹치면 긴 것·신뢰도 높은 것을 남긴다.
 * 예: detect('고객 이예시님 010-0000-1234') → [{kind:'name',…}, {kind:'phone',…}]
 */
export function detect(text: string, opts: DetectOptions = {}): Detection[] {
  assertText(text, 'detect(text)');
  assertDetectOptions(opts, 'detect(text, options)');
  return resolveOverlaps(detectRaw(text, opts)).map(({ kind, value, start, end, confidence }) => ({
    kind,
    value,
    start,
    end,
    confidence,
  }));
}
