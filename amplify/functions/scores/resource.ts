import { defineFunction } from '@aws-amplify/backend';

export const scoresFn = defineFunction({
  name: 'scores-fn',
  entry: './handler.ts',
  // environment: { TABLE_NAME: '後で custom から付与', GSI1_NAME: '後で custom から付与' }
});
