import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 소비자 회귀 테스트(npm pack + 임시 프로젝트 설치 + tsc)가 몇십 초 걸릴 수 있다
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
