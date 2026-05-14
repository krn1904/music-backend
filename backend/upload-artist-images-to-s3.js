// Download cover URLs from the JSON dataset, upload one object per artist to S3,
// then point each DynamoDB song row's image_url at that S3 key (for presigned URLs in the app).
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
require('dotenv').config({ path: '../.env' });

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'music';
const S3_BUCKET = process.env.S3_BUCKET;
// Keys land under this prefix so the bucket can hold other stuff later without clashes.
const S3_PREFIX = (process.env.S3_IMAGE_PREFIX || 'artist-images/').replace(/^\/+/, '');
const DEFAULT_DATA_FILE = './2026a2_songs.json';

if (!S3_BUCKET) {
  console.error('Missing required env var: S3_BUCKET');
  process.exit(1);
}

const requiredEnv = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  console.error(`Missing required env vars: ${missingEnv.join(', ')}`);
  process.exit(1);
}

function asTrimmedString(value) {
  if (value == null) return '';
  return String(value).trim();
}

// JSON might be a bare array or wrapped — normalize to a list of song objects.
function getRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.songs)) return payload.songs;
  if (Array.isArray(payload.items)) return payload.items;
  throw new Error('Unsupported JSON format. Expected array, songs[], or items[].');
}

// Map response Content-Type to a file extension when the remote URL has no useful path suffix.
function guessExtFromContentType(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('image/jpeg')) return '.jpg';
  if (ct.includes('image/png')) return '.png';
  if (ct.includes('image/webp')) return '.webp';
  if (ct.includes('image/gif')) return '.gif';
  return '';
}

// Safe filename segment from artist name for the S3 key.
function slugifyArtistName(artist) {
  return String(artist)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// One key per artist: prefix + slug + extension from Content-Type or original URL.
function buildArtistS3Key(artist, contentType, sourceUrl) {
  const slug = slugifyArtistName(artist) || 'unknown-artist';
  const ext = guessExtFromContentType(contentType) || path.extname(new URL(sourceUrl).pathname) || '.img';
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `${S3_PREFIX}${slug}${normalizedExt}`;
}

// Skip re-upload if we already ran this script — saves time and write costs.
async function headIfExists(s3, bucket, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return false;
    return false;
  }
}

// Simple GET of the public image URL — Node 18+ has global fetch.
async function downloadImage(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}) for ${imageUrl}`);
  }
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

async function run() {
  // Optional: node upload-artist-images-to-s3.js path/to/other.json
  const dataFileArg = process.argv[2];
  const dataFilePath = path.resolve(__dirname, dataFileArg || DEFAULT_DATA_FILE);
  if (!fs.existsSync(dataFilePath)) {
    throw new Error(`Data file not found: ${dataFilePath}`);
  }

  const jsonText = fs.readFileSync(dataFilePath, 'utf-8');
  const payload = JSON.parse(jsonText);
  const rawRecords = getRecords(payload);

  const s3 = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN
    }
  });

  const dynamodbClient = new DynamoDBClient({
    region: AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN
    }
  });
  const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);

  // Dedupe by artist: many songs share one image — upload once, reuse the key for every row.
  const artistToSourceUrl = new Map();
  for (const raw of rawRecords) {
    const artist = asTrimmedString(raw.artist);
    const imageUrl = asTrimmedString(raw.img_url || raw.image_url);
    if (!artist || !imageUrl) continue;
    if (!artistToSourceUrl.has(artist)) {
      artistToSourceUrl.set(artist, imageUrl);
    }
  }

  console.log(`Found ${artistToSourceUrl.size} artists with a source image URL.`);

  // After uploads, artist -> S3 object key (used in the Dynamo pass below).
  const artistKeyMap = new Map(); // artist -> s3Key
  let uploaded = 0;
  let skippedExisting = 0;
  let failed = 0;

  // Phase 1: fetch remote image bytes and PutObject once per artist.
  for (const [artist, imageUrl] of artistToSourceUrl.entries()) {
    try {
      const { buffer, contentType } = await downloadImage(imageUrl);
      const key = buildArtistS3Key(artist, contentType, imageUrl);

      const exists = await headIfExists(s3, S3_BUCKET, key);
      if (exists) {
        skippedExisting += 1;
        artistKeyMap.set(artist, key);
        continue;
      }

      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: contentType
        })
      );

      uploaded += 1;
      artistKeyMap.set(artist, key);
      console.log(`Uploaded: s3://${S3_BUCKET}/${key}`);
    } catch (err) {
      failed += 1;
      console.error(`Failed artist image: ${artist} (${imageUrl})`, err?.message || err);
    }
  }

  console.log(`Upload summary: uploaded=${uploaded}, skippedExisting=${skippedExisting}, failed=${failed}`);

  // Update DynamoDB so each song's image_url points to the S3 key.
  // Table key schema: HASH=Artist, RANGE=SongTitleYear ("title#year").
  let updatedSongs = 0;
  let skippedSongs = 0;
  let failedSongs = 0;

  // Phase 2: patch each song row — load-music should have created these items already.
  for (const raw of rawRecords) {
    const artist = asTrimmedString(raw.artist);
    const songTitle = asTrimmedString(raw.title);
    const year = asTrimmedString(raw.year);
    if (!artist || !songTitle || !year) {
      skippedSongs += 1;
      continue;
    }

    const s3Key = artistKeyMap.get(artist);
    if (!s3Key) {
      skippedSongs += 1;
      continue;
    }

    const songTitleYear = `${songTitle}#${year}`;

    try {
      await dynamodb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { Artist: artist, SongTitleYear: songTitleYear },
          UpdateExpression: 'SET image_url = :k',
          ExpressionAttributeValues: { ':k': s3Key },
          // No-op safely if this key combo isn't in the table yet (e.g. data out of sync).
          ConditionExpression:
            'attribute_exists(Artist) AND attribute_exists(SongTitleYear)'
        })
      );
      updatedSongs += 1;
    } catch (err) {
      if (err?.name === 'ConditionalCheckFailedException') {
        skippedSongs += 1;
        continue;
      }
      failedSongs += 1;
      console.error(
        `DynamoDB update failed for ${artist} / ${songTitleYear}:`,
        err?.message || err
      );
    }
  }

  console.log(
    `DynamoDB update summary: updatedSongs=${updatedSongs}, skippedSongs=${skippedSongs}, failedSongs=${failedSongs}`
  );
  console.log('Done.');
}

run().catch((error) => {
  console.error('S3 upload + DynamoDB update failed:', error?.message || error);
  process.exit(1);
});

