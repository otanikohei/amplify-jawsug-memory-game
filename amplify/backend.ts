import { defineBackend } from '@aws-amplify/backend';
import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Cors, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';

import { scoresFn } from './functions/scores/resource';

// ★ 既存の data などがある場合は { data, scoresFn } にしてください
export const backend = defineBackend({
  scoresFn,
});

// 1つの Stack にまとめる（Gen2 推奨）
const apiStack = backend.createStack('ApiStack');

// --- DynamoDB ---
const table = new Table(apiStack, 'ScoresTable', {
  partitionKey: { name: 'id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN, // 検証環境なら DESTROY でもOK
});

// ランキング用の GSI（PK 固定 "RANK" / SK=score）
table.addGlobalSecondaryIndex({
  indexName: 'gsi1',
  partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
  sortKey: { name: 'score', type: AttributeType.NUMBER },
  projectionType: ProjectionType.ALL,
});

// Lambda に権限 & 環境変数
table.grantReadWriteData(backend.scoresFn.resources.lambda);
table.grantReadWriteData(backend.scoresFn.resources.lambda);           // ← これはOK


// --- API Gateway (REST) ---
const api = new RestApi(apiStack, 'ScoresApi', {
  restApiName: 'scores-api',
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: Cors.DEFAULT_HEADERS,
  },
});
const scores = api.root.addResource('scores');
const integ = new LambdaIntegration(backend.scoresFn.resources.lambda); // ← これもOK
scores.addMethod('GET', integ);
scores.addMethod('POST', integ);

// api.url はビルド後のログに出ます
