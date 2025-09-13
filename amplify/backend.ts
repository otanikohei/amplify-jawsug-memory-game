import { defineBackend } from '@aws-amplify/backend';
import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Cors, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';

// 既存のリソースをここで import 済みのはず（例）
// import { data } from './data/resource';
import { scoresFn } from './functions/scores/resource';

// ★ 既存の defineBackend に scoresFn を「合流」させる
// 例：既に data があるなら { data, scoresFn } のようにまとめる
export const backend = defineBackend({
  // data,  // ← 既存があれば残す
  scoresFn,
});

// 公式推奨: 1つの Stack を作る
const apiStack = backend.createStack('ApiStack');

// --- DynamoDB ---
const table = new Table(apiStack, 'ScoresTable', {
  partitionKey: { name: 'id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN, // 本番はRETAIN推奨（消したい検証環境なら DESTROY）
});

// ランキング用 GSI（固定PK "RANK", SK=score の降順クエリ）
table.addGlobalSecondaryIndex({
  indexName: 'gsi1',
  partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
  sortKey: { name: 'score', type: AttributeType.NUMBER },
  projectionType: ProjectionType.ALL,
});

// Lambda に権限 & 環境変数
table.grantReadWriteData(backend.scoresFn.resources.lambda);
backend.scoresFn.resources.lambda.addEnvironment('TABLE_NAME', table.tableName);
backend.scoresFn.resources.lambda.addEnvironment('GSI1_NAME', 'gsi1');

// --- REST API ---
const api = new RestApi(apiStack, 'ScoresApi', {
  restApiName: 'scores-api',
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: Cors.DEFAULT_HEADERS,
  },
});

const scores = api.root.addResource('scores');
const integ = new LambdaIntegration(backend.scoresFn.resources.lambda);
scores.addMethod('GET', integ);
scores.addMethod('POST', integ);

// （api.url はビルド後のログで確認できます）
