const {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists
} = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
require('dotenv').config({ path: '../.env' });

const LOGIN_TABLE_NAME = process.env.DYNAMODB_LOGIN_TABLE || 'login';
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

const dynamodb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true }
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

function buildSeedUsers() {
  const now = new Date().toISOString();
  return [
    { Email: 's41235511@student.rmit.edu.au', UserName: 'karan1', Password: '012345', CreatedAt: now },
    { Email: 's41235522@student.rmit.edu.au', UserName: 'karan2', Password: '012345', CreatedAt: now },
    { Email: 's41235533@student.rmit.edu.au', UserName: 'karan3', Password: '012345', CreatedAt: now },
    { Email: 's41235544@student.rmit.edu.au', UserName: 'karan4', Password: '012345', CreatedAt: now },
    { Email: 's41235555@student.rmit.edu.au', UserName: 'karan5', Password: '012345', CreatedAt: now },
    { Email: 's41235566@student.rmit.edu.au', UserName: 'karan6', Password: '012345', CreatedAt: now },
    { Email: 's41235577@student.rmit.edu.au', UserName: 'karan7', Password: '012345', CreatedAt: now },
    { Email: 's41235588@student.rmit.edu.au', UserName: 'karan8', Password: '012345', CreatedAt: now },
    { Email: 's41235599@student.rmit.edu.au', UserName: 'karan9', Password: '012345', CreatedAt: now },
    { Email: 's41235600@student.rmit.edu.au', UserName: 'karan10', Password: '012345', CreatedAt: now }
  ];
}

async function createLoginTableIfMissing() {
  const exists = await tableExists(LOGIN_TABLE_NAME);
  if (exists) {
    console.log(`Table "${LOGIN_TABLE_NAME}" already exists. Continuing to seed data.`);
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName: LOGIN_TABLE_NAME,
      AttributeDefinitions: [{ AttributeName: 'Email', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'Email', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST'
    })
  );

  await waitUntilTableExists(
    { client, maxWaitTime: 60 },
    { TableName: LOGIN_TABLE_NAME }
  );

  console.log(`Table "${LOGIN_TABLE_NAME}" created successfully.`);
}

async function seedLoginUsers(users) {
  // BatchWrite overwrites matching keys, making this script idempotent for setup.
  const putRequests = users.map((user) => ({ PutRequest: { Item: user } }));
  await dynamodb.send(
    new BatchWriteCommand({
      RequestItems: {
        [LOGIN_TABLE_NAME]: putRequests
      }
    })
  );
}

async function run() {
  const users = buildSeedUsers();
  await createLoginTableIfMissing();
  await seedLoginUsers(users);

  console.log(`Inserted/updated ${users.length} users into "${LOGIN_TABLE_NAME}".`);
  console.log('Seeded login emails:');
  for (const user of users) {
    console.log(`- ${user.Email} (${user.UserName})`);
  }
}

run().catch((error) => {
  console.error('Failed to create/seed login table:', error.message);
  process.exit(1);
});
