const fs = require('fs');
const path = require('path');
const {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists
} = require('@aws-sdk/client-dynamodb');
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

async function tableExists(tableName) {
  try {
    await dynamodbClient.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error?.name === 'ResourceNotFoundException') return false;
    throw error;
  }
}

async function ensureMusicTable() {
  const exists = await tableExists(TABLE_NAME);
  if (exists) return;

  await dynamodbClient.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      AttributeDefinitions: [
        { AttributeName: 'Artist', AttributeType: 'S' },
        { AttributeName: 'SongTitle', AttributeType: 'S' }
      ],
      KeySchema: [
        { AttributeName: 'Artist', KeyType: 'HASH' },
        { AttributeName: 'SongTitle', KeyType: 'RANGE' }
      ],
      BillingMode: 'PAY_PER_REQUEST'
    })
  );

  await waitUntilTableExists(
    { client: dynamodbClient, maxWaitTime: 60 },
    { TableName: TABLE_NAME }
  );
}

function getRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.songs)) return payload.songs;
  if (Array.isArray(payload.items)) return payload.items;
  throw new Error('Unsupported JSON format. Expected array, songs[], or items[].');
}

function asTrimmedString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function toMusicItem(raw, rowIndex) {
  const artist = asTrimmedString(raw.artist);
  const songTitle = asTrimmedString(raw.title);
  const album = asTrimmedString(raw.album);
  const year = asTrimmedString(raw.year);
  const imageUrl = asTrimmedString(raw.img_url);

  if (!artist || !songTitle) {
    return {
      item: null,
      reason: `Row ${rowIndex + 1}: missing required key fields (artist/title)`
    };
  }

  return {
    item: {
      Artist: artist,
      SongTitle: songTitle,
      Album: album,
      Year: year,
      image_url: imageUrl
    },
    reason: null
  };
}

async function run() {
  await ensureMusicTable();

  if (!fs.existsSync(dataFilePath)) {
    throw new Error(`Data file not found: ${dataFilePath}`);
  }

  const jsonText = fs.readFileSync(dataFilePath, 'utf-8');
  const payload = JSON.parse(jsonText);
  const rawRecords = getRecords(payload);

  let created = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  const invalidReasons = [];
  const sourceCompositeKeys = new Set();

  for (const [index, raw] of rawRecords.entries()) {
    const { item, reason } = toMusicItem(raw, index);
    if (!item) {
      skippedInvalid += 1;
      invalidReasons.push(reason);
      continue;
    }

    const sourceKey = `${item.Artist}#${item.SongTitle}`;
    if (sourceCompositeKeys.has(sourceKey)) {
      skippedInvalid += 1;
      invalidReasons.push(
        `Row ${index + 1}: duplicate artist/title in source payload (${sourceKey})`
      );
      continue;
    }
    sourceCompositeKeys.add(sourceKey);

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
  if (invalidReasons.length > 0) {
    console.log('Invalid row details:');
    for (const reason of invalidReasons) {
      console.log(`- ${reason}`);
    }
  }
}

run().catch((error) => {
  console.error('Music import failed:', error.message);
  process.exit(1);
});
