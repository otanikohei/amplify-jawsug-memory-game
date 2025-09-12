import { defineFunction } from '@aws-amplify/backend';

export const scoresFn = defineFunction({
  name: 'scores-fn',
  entry: './handler.ts',
  // 必要ならメモリ/タイムアウト等は後で調整できます
});
