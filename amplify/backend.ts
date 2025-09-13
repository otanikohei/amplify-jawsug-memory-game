import { defineBackend } from '@aws-amplify/backend';
import { RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Cors, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { scoresFn } from './functions/scores/resource';
import { storage } from './storage/resource';

export const backend = defineBackend({ scoresFn });

/**
 * スタック構成：
 *   dbStack   … DynamoDB（← Function スタックが参照）
 *   apiStack  … API Gateway（← Function スタックを参照）
 *   function  … scoresFn（デフォルトの関数スタック）
 */

// --- DB スタック（DynamoDB だけ置く）---
const dbStack = backend.createStack('db');

const table = new Table(dbStack, 'ScoresTable', {
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

// Lambda に権限と環境変数を付与（これは “Function スタック側” にポリシー等が乗る）
table.grantReadWriteData(backend.scoresFn.resources.lambda);
backend.scoresFn.addEnvironment('TABLE_NAME', table.tableName);
backend.scoresFn.addEnvironment('GSI1_NAME', 'gsi1');

// --- API スタック（RestApi だけ置く）---
const apiStack = backend.createStack('api');

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
scores.addMethod('GET',  scoresInteg);
scores.addMethod('POST', scoresInteg);

// 出力（Amplify Backend → Outputs に出ます）
new CfnOutput(apiStack, 'ScoresApiId',  { value: api.restApiId });
new CfnOutput(apiStack, 'ScoresApiUrl', { value: api.url ?? '' });

defineBackend({
  storage
});