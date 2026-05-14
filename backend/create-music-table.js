// create the music catalog table + indexes (no data load here).
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

// Exit early if the table is already there — CreateTable would throw ResourceInUseException.
async function run() {
  const exists = await tableExists(TABLE_NAME);
  if (exists) {
    console.log(`Table "${TABLE_NAME}" already exists. No action required.`);
    return;
  }

  // Dynamo only needs key attributes declared here; everything else (SongTitle, image_url, …)
  // is just stored on each item.
  //
  // Range key is SongTitleYear (e.g. "Delicate#2018") so two different years don't collide;
  // SongTitle on the item is still the human-readable title for the UI and search.
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
      // LSI shares the base table partition (Artist) — cheap queries by album for one artist.
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
      // GSI uses Year as HASH so /by-year can query without scanning the whole table.
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

  // Same idea as login script: wait until status is ACTIVE before you load data elsewhere.
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
