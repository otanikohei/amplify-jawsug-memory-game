import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AttributeType, BillingMode, Table, ProjectionType } from 'aws-cdk-lib/aws-dynamodb';
import { RestApi, Cors, LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { defineBackend } from '@aws-amplify/backend';
import { scoresFn } from '../functions/scores/resource';

const backend = defineBackend({
  scoresFn, // 後段で参照
});

// === Custom CDK Stack ===
export class CustomResources extends Construct {
  public readonly apiUrlOutput: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const stack = Stack.of(this);

    // DynamoDB
    const table = new Table(this, 'ScoresTable', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: undefined, // 自動命名（環境ごとにユニーク）
      removalPolicy: stack.node.tryGetContext('removalPolicy') ?? 1, // 本番は消さない設定に調整を
    });

    // GSI: RANK 用 (pk固定, sk=score)
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey: { name: 'score', type: AttributeType.NUMBER },
      projectionType: ProjectionType.ALL,
    });

    // Lambda に権限 & 環境変数を付与
    table.grantReadWriteData(backend.resources.scoresFn.resources.lambda);
    backend.resources.scoresFn.resources.lambda.addEnvironment('TABLE_NAME', table.tableName);
    backend.resources.scoresFn.resources.lambda.addEnvironment('GSI1_NAME', 'gsi1');

    // REST API
    const api = new RestApi(this, 'ScoresApi', {
      restApiName: 'scores-api',
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: Cors.DEFAULT_HEADERS,
      },
    });

    const scores = api.root.addResource('scores');
    const integ = new LambdaIntegration(backend.resources.scoresFn.resources.lambda);
    scores.addMethod('GET', integ);
    scores.addMethod('POST', integ);

    // URL を出力（Amplifyの出力取り回しは UI で確認可）
    this.apiUrlOutput = api.url ?? '';
  }
}

// amplify に custom stack を差し込む
backend.addResource(new CustomResources(backend.stack, 'CustomResources'));
