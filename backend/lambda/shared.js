const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand
} = require('@aws-sdk/lib-dynamodb');

// load root .env when I run handlers locally — in AWS the lambda env/config wins
require('dotenv').config({ path: '../../.env' });

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'music';
const LOGIN_TABLE_NAME = process.env.DYNAMODB_LOGIN_TABLE || 'login';
const SUBSCRIPTIONS_TABLE_NAME =
  process.env.DYNAMODB_SUBSCRIPTIONS_TABLE || 'subscriptions';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const S3_BUCKET = process.env.S3_BUCKET || '';
const IMAGE_URL_TTL_SECONDS = Number.parseInt(
  process.env.S3_SIGNED_URL_TTL_SECONDS || '900',
  10
); // presigned cover art links expire after this many seconds

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;

// standard API Gateway-ish response the frontend can read + loose CORS for the SPA
function buildResponse(statusCode, payload, extraHeaders) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      ...(extraHeaders || {})
    },
    body: JSON.stringify(payload)
  };
}

// same envelope every time the UI needs to show an error toast
function sendError(statusCode, message, details) {
  return buildResponse(statusCode, {
    success: false,
    error: {
      message,
      details: details || null
    }
  });
}

function parseJsonBody(event) {
  if (!event?.body) return {};
  try {
    // REST API can base64 the body — decode before JSON.parse
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON body: ${error.message}`);
  }
}

// tiny helper so we don't try to "sign" strings that are already normal URLs
function looksLikeHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

// lambda uses the execution role — no keys hardcoded in here
const dynamodbClient = new DynamoDBClient({
  region: AWS_REGION
});
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);

const s3 = new S3Client({
  region: AWS_REGION
});

async function toSignedImageUrl(imageUrlOrKey) {
  const raw = typeof imageUrlOrKey === 'string' ? imageUrlOrKey.trim() : '';
  if (!raw) return { imageKey: '', imageSignedUrl: '' };

  // already hosted somewhere — just pass it through
  if (looksLikeHttpUrl(raw)) {
    return { imageKey: '', imageSignedUrl: raw };
  }

  // local/dev without bucket — return the raw key so I can still see what broke
  if (!S3_BUCKET) {
    return { imageKey: raw, imageSignedUrl: '' };
  }

  // don't hand out multi-hour URLs by accident
  const safeTtl =
    Number.isFinite(IMAGE_URL_TTL_SECONDS) && IMAGE_URL_TTL_SECONDS > 0
      ? Math.min(Math.max(IMAGE_URL_TTL_SECONDS, 60), 3600)
      : 900;

  const signedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: raw }),
    { expiresIn: safeTtl }
  );

  return { imageKey: raw, imageSignedUrl: signedUrl };
}

// nextToken the client sends back — was json then base64
function decodePageToken(token) {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
  } catch (error) {
    throw new Error(`Invalid pagination token: ${error.message}`);
  }
}

// dynamo LastEvaluatedKey or our own { offset: n } — either way it round-trips opaque
function encodePageToken(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf-8').toString(
    'base64'
  );
}

// one string that uniquely names a track for the subscription sort key
function buildSongKey(artist, songTitle, year) {
  return `${String(artist).trim()}#${String(songTitle).trim()}#${String(
    year || ''
  ).trim()}`;
}

function getPath(event) {
  const raw = String(event?.path || event?.rawPath || '').trim();
  // strip the /prod stage prefix API Gateway sometimes leaves on the path
  const parts = raw.split('/').filter(Boolean);
  if (parts.length > 0 && parts[0] === 'prod') {
    return '/' + parts.slice(1).join('/');
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

module.exports = {
  TABLE_NAME,
  LOGIN_TABLE_NAME,
  SUBSCRIPTIONS_TABLE_NAME,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildResponse,
  sendError,
  parseJsonBody,
  dynamodb,
  ScanCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  toSignedImageUrl,
  decodePageToken,
  encodePageToken,
  buildSongKey,
  getPath
};

