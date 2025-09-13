import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';

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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

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

      const score = pairs * 10000 - seconds; // 高いほど上位

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
        ScanIndexForward: false, // 降順
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
