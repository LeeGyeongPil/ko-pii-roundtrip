import { defineConfig } from 'tsdown';

// 엔트리 3개(코어·ai-sdk·openai)를 ESM(.mjs)과 CJS(.cjs) 두 벌로, 타입(.d.mts·.d.cts)과 함께 만든다.
// ai·openai 는 peerDependencies 라 tsdown 이 번들에 넣지 않는다(어댑터는 타입으로만 참조).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'ai-sdk': 'src/ai-sdk.ts',
    openai: 'src/openai.ts',
  },
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node22.12',
  dts: true,
  clean: true,
  sourcemap: false,
});
