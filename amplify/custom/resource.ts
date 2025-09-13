import { defineBackend } from '@aws-amplify/backend';
import { scoresFn } from '../functions/scores/resource';

import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Cors, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';

const backend = defineBackend({ scoresFn });

// 公式推奨: まずは Stack を作る
const apiStack = backend.createStack('ApiStack');

// --- DynamoDB ---
const table = new Table(apiStack, 'ScoresTable', {
  partitionKey: { name: 'id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN, // 本番は消さない（必要に応じて DESTROY に変更）
});

// ランキング用GSI（固定PK "RANK", SK=score の降順クエリ）
table.addGlobalSecondaryIndex({
  indexName: 'gsi1',
  partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
  sortKey: { name: 'score', type: AttributeType.NUMBER },
  projectionType: ProjectionType.ALL,
});

// Lambda にDDB権限 & 環境変数
table.grantReadWriteData(backend.scoresFn.resources.lambda);
backend.scoresFn.resources.lambda.addEnvironment('TABLE_NAME', table.tableName);
backend.scoresFn.resources.lambda.addEnvironment('GSI1_NAME', 'gsi1');

// --- REST API (API Gateway) ---
const api = new RestApi(apiStack, 'ScoresApi', {
  restApiName: 'scores-api',
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: Cors.DEFAULT_HEADERS,
  },
});

// ルート: /scores (GET/POST)
const scores = api.root.addResource('scores');
const integ = new LambdaIntegration(backend.scoresFn.resources.lambda);
scores.addMethod('GET', integ);
scores.addMethod('POST', integ);

// デフォルトで "prod" ステージが発行されます（api.url をビルドログで確認できます）
