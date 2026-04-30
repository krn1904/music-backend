const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
require('dotenv').config({ path: '../.env' });

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'music';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const DEFAULT_DATA_FILE = './2026a2_songs.json';
const dataFileArg = process.argv[2];
const dataFilePath = path.resolve(
  __dirname,
  dataFileArg || DEFAULT_DATA_FILE
);

const requiredEnv = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN'
];

const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  console.error(`Missing required env vars: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const dynamodbClient = new DynamoDBClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN
  }
});

const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);

function getRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.songs)) return payload.songs;
  if (Array.isArray(payload.items)) return payload.items;
  throw new Error('Unsupported JSON format. Expected array, songs[], or items[].');
}

function toMusicItem(raw) {
  const artist = raw.artist;
  const songTitle = raw.title;
  const album = raw.album || '';
  const year = raw.year || '';
  const imageUrl = raw.img_url || '';

  if (!artist || !songTitle) {
    return null;
  }

  return {
    Artist: artist,
    SongTitle: songTitle,
    Album: album,
    Year: year,
    image_url: imageUrl
  };
}

async function run() {
  if (!fs.existsSync(dataFilePath)) {
    throw new Error(`Data file not found: ${dataFilePath}`);
  }

  const jsonText = fs.readFileSync(dataFilePath, 'utf-8');
  const payload = JSON.parse(jsonText);
  const rawRecords = getRecords(payload);

  let created = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;

  for (const raw of rawRecords) {
    const item = toMusicItem(raw);
    if (!item) {
      skippedInvalid += 1;
      continue;
    }

    try {
      await dynamodb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression:
            'attribute_not_exists(Artist) AND attribute_not_exists(SongTitle)'
        })
      );
      created += 1;
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        skippedDuplicate += 1;
        continue;
      }
      throw error;
    }
  }

  console.log('Music import completed.');
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Source file: ${dataFilePath}`);
  console.log(`Inserted: ${created}`);
  console.log(`Skipped duplicates: ${skippedDuplicate}`);
  console.log(`Skipped invalid rows: ${skippedInvalid}`);
}

run().catch((error) => {
  console.error('Music import failed:', error.message);
  process.exit(1);
});
