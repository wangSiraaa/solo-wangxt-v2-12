import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 20000,
    env: { DB_TYPE: 'sqljs' },
  },
  plugins: [
    // TypeORM entities rely on emitted decorator metadata for column type
    // inference; esbuild does not emit it, swc does.
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
