// amplify/backend.ts
import { defineBackend } from '@aws-amplify/backend';
import { RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Cors, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { scoresFn } from './functions/scores/resource';

// 既存の data 等があるなら { data, scoresFn } と一緒にここへ
export const backend = defineBackend({ scoresFn });

// 1つの Stack にまとめる
const apiStack = backend.getStack('api');

// --- DynamoDB ---
const table = new Table(apiStack, 'ScoresTable', {
  partitionKey: { name: 'id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN,
});
table.addGlobalSecondaryIndex({
  indexName: 'gsi1',
  partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
  sortKey: { name: 'score', type: AttributeType.NUMBER },
  projectionType: ProjectionType.ALL,
});

// Lambda 権限 & 環境変数
table.grantReadWriteData(backend.scoresFn.resources.lambda);
backend.scoresFn.addEnvironment('TABLE_NAME', table.tableName);
backend.scoresFn.addEnvironment('GSI1_NAME', 'gsi1');

// --- API Gateway (REST v1) ---
const api = new RestApi(apiStack, 'ScoresApi', {
  restApiName: 'scores-api',
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: Cors.DEFAULT_HEADERS,
  },
});
const scores = api.root.addResource('scores');
const scoresInteg = new LambdaIntegration(backend.scoresFn.resources.lambda);
scores.addMethod('GET', scoresInteg);
scores.addMethod('POST', scoresInteg);

// ★ これがあると Amplify の Backend Outputs に URL が必ず出ます
new CfnOutput(apiStack, 'ScoresApiId',  { value: api.restApiId });
new CfnOutput(apiStack, 'ScoresApiUrl', { value: api.url ?? '' }); // 末尾に / が付くことあり
