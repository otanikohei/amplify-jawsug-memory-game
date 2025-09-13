// 旧: import { randomUUID } from 'node:crypto';
import { randomUUID as nativeRandomUUID, randomBytes } from 'crypto';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';

// ランタイムに randomUUID が無い場合のフォールバック
const randomUUID =
  typeof nativeRandomUUID === 'function'
    ? nativeRandomUUID
    : () => {
        const b = randomBytes(16);
        b[6] = (b[6] & 0x0f) | 0x40; // version 4
        b[8] = (b[8] & 0x3f) | 0x80; // variant
        const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      };

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const TABLE_NAME = process.env.TABLE_NAME!;
const GSI1_NAME = process.env.GSI1_NAME || 'gsi1';

const ddb = new DynamoDBClient({ region: REGION });

export const handler: APIGatewayProxyHandler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    if (event.httpMethod === 'POST' && event.path?.endsWith('/scores')) {
      const body = JSON.parse(event.body || '{}');
      const name = String(body.name ?? '').slice(0, 50);
      const pairs = Number(body.pairs ?? 0);
      const seconds = Number(body.seconds ?? 0);
      const playedAt = body.playedAt ? String(body.playedAt) : new Date().toISOString();

      if (!name || !Number.isFinite(pairs) || !Number.isFinite(seconds)) {
        return { statusCode: 400, headers, body: JSON.stringify({ message: 'invalid input' }) };
      }

      const score = pairs * 10000 - seconds;

      await ddb.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: {
          id:       { S: randomUUID() },
          name:     { S: name },
          pairs:    { N: String(pairs) },
          seconds:  { N: String(seconds) },
          playedAt: { S: playedAt },
          score:    { N: String(score) },
          gsi1pk:   { S: 'RANK' },
        },
      }));

      return { statusCode: 201, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && event.path?.endsWith('/scores')) {
      const limit = Math.min(100, Math.max(1, Number(event.queryStringParameters?.limit ?? 10)));

      const res = await ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: 'RANK' } },
        ScanIndexForward: false,
        Limit: limit,
      }));

      const items = (res.Items ?? []).map(it => ({
        name: it.name?.S ?? '',
        pairs: Number(it.pairs?.N ?? 0),
        seconds: Number(it.seconds?.N ?? 0),
        playedAt: it.playedAt?.S ?? '',
      }));

      return { statusCode: 200, headers, body: JSON.stringify(items) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ message: 'not found' }) };
  } catch (e: any) {
    console.error(e);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'internal error' }) };
  }
};
