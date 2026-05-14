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

// Optional for local invocation; in AWS Lambda set env vars in configuration.
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
);

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;

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
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON body: ${error.message}`);
  }
}

function looksLikeHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

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

  if (looksLikeHttpUrl(raw)) {
    return { imageKey: '', imageSignedUrl: raw };
  }

  if (!S3_BUCKET) {
    return { imageKey: raw, imageSignedUrl: '' };
  }

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

function decodePageToken(token) {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
  } catch (error) {
    throw new Error(`Invalid pagination token: ${error.message}`);
  }
}

function encodePageToken(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf-8').toString(
    'base64'
  );
}

function buildSongKey(artist, songTitle, year) {
  return `${String(artist).trim()}#${String(songTitle).trim()}#${String(
    year || ''
  ).trim()}`;
}

function getPath(event) {
  const raw = String(event?.path || event?.rawPath || '').trim();
  // REST API proxy sometimes includes the stage in the path (e.g. /prod/songs)
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

