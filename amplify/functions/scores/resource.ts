import { defineFunction } from '@aws-amplify/backend';

export const scoresFn = defineFunction({
  name: 'scores-fn',
  entry: './handler.ts',
  resourceGroupName: 'api',
});
