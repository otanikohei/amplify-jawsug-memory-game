import { defineBackend } from '@aws-amplify/backend';
import { CfnOutput, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Cors, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import {
  Distribution,
  ViewerProtocolPolicy,
  AllowedMethods,
  PriceClass,
  CachePolicy,
  ResponseHeadersPolicy,
  OriginAccessIdentity,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';

import { scoresFn } from './functions/scores/resource';

export const backend = defineBackend({ scoresFn });

/** 1) DB スタック（DynamoDB） */
const dbStack = backend.createStack('db');

const table = new Table(dbStack, 'ScoresTable', {
  partitionKey: { name: 'id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN, // 検証中に消したいなら DESTROY
});

table.addGlobalSecondaryIndex({
  indexName: 'gsi1',
  partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
  sortKey: { name: 'score', type: AttributeType.NUMBER },
  projectionType: ProjectionType.ALL,
});

// 関数に権限・環境変数
table.grantReadWriteData(backend.scoresFn.resources.lambda);
backend.scoresFn.addEnvironment('TABLE_NAME', table.tableName);
backend.scoresFn.addEnvironment('GSI1_NAME', 'gsi1');

/** 2) API スタック（API Gateway） */
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
scores.addMethod('GET', scoresInteg);
scores.addMethod('POST', scoresInteg);

// 出力（Amplify Backend → Outputs に出ます）
new CfnOutput(apiStack, 'ScoresApiId', { value: api.restApiId });
new CfnOutput(apiStack, 'ScoresApiUrl', { value: api.url ?? '' }); // 末尾に / が付くことあり

/** 3) CDN スタック（画像配信：S3+CloudFront, OAI） */
const cdnStack = backend.createStack('cdn');

const imagesBucket = new Bucket(cdnStack, 'ImagesBucket', {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  enforceSSL: true,
  removalPolicy: RemovalPolicy.RETAIN, // 検証中は DESTROY でもOK
});

// OAI（Origin Access Identity）でバケットを私的に保ったまま配信
const oai = new OriginAccessIdentity(cdnStack, 'ImagesOAI');

// 1年キャッシュ（immutable 前提）
const imagesCache = new CachePolicy(cdnStack, 'ImagesCachePolicy', {
  defaultTtl: Duration.days(365),
  maxTtl: Duration.days(365),
  minTtl: Duration.seconds(0),
  enableAcceptEncodingGzip: true,
  enableAcceptEncodingBrotli: true,
});

// 必要に応じて CORS/セキュリティヘッダ（Canvas 等に使う予定がなければ省略可）
const imagesHeaders = new ResponseHeadersPolicy(cdnStack, 'ImagesHeaders', {
  corsBehavior: {
    accessControlAllowOrigins: ['*'],
    accessControlAllowHeaders: ['*'],
    accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
    originOverride: true,
  },
});

// S3 を CloudFront オリジン化（OAI 付与）
const imagesOrigin = new S3Origin(imagesBucket, { originAccessIdentity: oai });

// ディストリビューション
const imagesCdn = new Distribution(cdnStack, 'ImagesCdn', {
  defaultBehavior: {
    origin: imagesOrigin,
    allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: imagesCache,
    responseHeadersPolicy: imagesHeaders,
  },
  priceClass: PriceClass.PRICE_CLASS_200,
});

// OAI に S3 読み取り許可
imagesBucket.grantRead(oai);

// 出力
new CfnOutput(cdnStack, 'ImagesBucketName', { value: imagesBucket.bucketName });
new CfnOutput(cdnStack, 'ImagesCdnUrl', {
  value: `https://${imagesCdn.distributionDomainName}`,
});
