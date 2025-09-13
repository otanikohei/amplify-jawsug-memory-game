// 先頭の import 群に追加
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
import { Duration } from 'aws-cdk-lib';

// === ここから追記（api/db の定義はそのまま）===

// 画像配信専用スタック
const cdnStack = backend.createStack('cdn');

// 画像用 S3（非公開／CloudFront からのみ読める）
const imagesBucket = new Bucket(cdnStack, 'ImagesBucket', {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  enforceSSL: true,
  removalPolicy: RemovalPolicy.RETAIN, // 検証用なら DESTROY でもOK
});

// CloudFront の OAI（Origin Access Identity）
const oai = new OriginAccessIdentity(cdnStack, 'ImagesOAI');

// CloudFront キャッシュポリシー（1年）
const oneYear = Duration.days(365);
const imagesCache = new CachePolicy(cdnStack, 'ImagesCachePolicy', {
  defaultTtl: oneYear,
  maxTtl: oneYear,
  minTtl: Duration.seconds(0),
  enableAcceptEncodingGzip: true,
  enableAcceptEncodingBrotli: true,
});

// （必要なら）レスポンスヘッダ。CORSが不要なら削ってOK
const imagesHeaders = new ResponseHeadersPolicy(cdnStack, 'ImagesHeaders', {
  corsBehavior: {
    accessControlAllowOrigins: ['*'],
    accessControlAllowHeaders: ['*'],
    accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
    originOverride: true,
  },
});

// S3 を CloudFront のオリジンに設定（OAI を付与）
const imagesOrigin = new S3Origin(imagesBucket, { originAccessIdentity: oai });

// CloudFront ディストリビューション
const imagesCdn = new Distribution(cdnStack, 'ImagesCdn', {
  defaultBehavior: {
    origin: imagesOrigin,
    allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: imagesCache,
    responseHeadersPolicy: imagesHeaders,
  },
  priceClass: PriceClass.PRICE_CLASS_200, // 予算に合わせて 100/200/ALL
});

// 出力（Amplify の Backend → Outputs で参照できる）
new CfnOutput(cdnStack, 'ImagesBucketName', {
  value: imagesBucket.bucketName,
});
new CfnOutput(cdnStack, 'ImagesCdnUrl', {
  value: `https://${imagesCdn.distributionDomainName}`, // ← これをフロントのベースURLに使う
});
