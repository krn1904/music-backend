const {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists
} = require('@aws-sdk/client-dynamodb');
require('dotenv').config({ path: '../.env' });

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'music';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

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

const client = new DynamoDBClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN
  }
});

async function tableExists(tableName) {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error?.name === 'ResourceNotFoundException') return false;
    throw error;
  }
}

async function run() {
  const exists = await tableExists(TABLE_NAME);
  if (exists) {
    console.log(`Table "${TABLE_NAME}" already exists. No action required.`);
    return;
  }

  // AttributeDefinitions only declare attributes used as keys (base table or
  // index). Non-key attributes (SongTitle for display, image_url) are stored
  // per item without being declared here.
  //
  // Base table SK is the synthetic SongTitleYear (e.g. "Delicate#2018") so
  // legitimate re-releases coexist as distinct rows. Plain SongTitle remains
  // on every item for display, search, and back-compat.
  await client.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      AttributeDefinitions: [
        { AttributeName: 'Artist', AttributeType: 'S' },
        { AttributeName: 'SongTitleYear', AttributeType: 'S' },
        { AttributeName: 'Album', AttributeType: 'S' },
        { AttributeName: 'Year', AttributeType: 'S' }
      ],
      KeySchema: [
        { AttributeName: 'Artist', KeyType: 'HASH' },
        { AttributeName: 'SongTitleYear', KeyType: 'RANGE' }
      ],
      LocalSecondaryIndexes: [
        {
          IndexName: 'AlbumIndex',
          KeySchema: [
            { AttributeName: 'Artist', KeyType: 'HASH' },
            { AttributeName: 'Album', KeyType: 'RANGE' }
          ],
          Projection: { ProjectionType: 'ALL' }
        }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'YearArtistIndex',
          KeySchema: [
            { AttributeName: 'Year', KeyType: 'HASH' },
            { AttributeName: 'Artist', KeyType: 'RANGE' }
          ],
          Projection: { ProjectionType: 'ALL' }
        }
      ],
      BillingMode: 'PAY_PER_REQUEST'
    })
  );

  await waitUntilTableExists(
    { client, maxWaitTime: 60 },
    { TableName: TABLE_NAME }
  );

  console.log(`Table "${TABLE_NAME}" created successfully.`);
  console.log(
    'Item attributes supported by your app: SongTitle, SongTitleYear, Artist, Year, Album, image_url'
  );
  console.log('Indexes: LSI AlbumIndex (Artist+Album), GSI YearArtistIndex (Year+Artist)');
}

run().catch((error) => {
  console.error('Failed to create music table:', error.message);
  process.exit(1);
});
