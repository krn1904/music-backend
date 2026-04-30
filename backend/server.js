const express = require('express');
const cors = require('cors');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand
} = require('@aws-sdk/lib-dynamodb');
require('dotenv').config({ path: '../.env' });

const app = express();
app.use(cors());
app.use(express.json());

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'music';
const LOGIN_TABLE_NAME = process.env.DYNAMODB_LOGIN_TABLE || 'login';
const SUBSCRIPTIONS_TABLE_NAME =
  process.env.DYNAMODB_SUBSCRIPTIONS_TABLE || 'subscriptions';
const PORT = 3001;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;

const sendError = (res, status, message, details) => {
  res.status(status).json({
    success: false,
    error: {
      message,
      details: details || null
    }
  });
};

const dynamodbClient = new DynamoDBClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN
  }
});

const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);

function decodePageToken(token) {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
  } catch (error) {
    throw new Error(`Invalid pagination token: ${error.message}`);
  }
}

function encodePageToken(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf-8').toString('base64');
}

// Fetch all songs from the table
app.get('/songs', async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    let exclusiveStartKey;
    if (req.query.nextToken) {
      try {
        exclusiveStartKey = decodePageToken(req.query.nextToken);
      } catch (tokenError) {
        return sendError(res, 400, 'Invalid pagination token', tokenError.message);
      }
    }

    const data = await dynamodb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey
      })
    );

    const nextToken = encodePageToken(data.LastEvaluatedKey);

    return res.json({
      success: true,
      items: data.Items || [],
      pagination: {
        limit,
        nextToken,
        hasNextPage: Boolean(nextToken)
      }
    });
  } catch (error) {
    console.error('GET /songs failed:', error);
    return sendError(res, 500, 'Failed to fetch songs', error.message);
  }
});

// Register a new user (plaintext password for assignment simplicity).
app.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    if (!username || !email || !password) {
      return sendError(res, 400, 'Missing required fields');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUserName = String(username).trim();
    const normalizedPassword = String(password);
    const createdAt = new Date().toISOString();

    if (!normalizedEmail.includes('@')) {
      return sendError(res, 400, 'Invalid email address');
    }

    await dynamodb.send(
      new PutCommand({
        TableName: LOGIN_TABLE_NAME,
        Item: {
          Email: normalizedEmail,
          UserName: normalizedUserName,
          Password: normalizedPassword,
          CreatedAt: createdAt
        },
        // Since the table key is Email (HASH), this enforces unique email at DB level.
        ConditionExpression: 'attribute_not_exists(Email)'
      })
    );

    return res.status(201).json({
      success: true,
      user: { email: normalizedEmail, username: normalizedUserName }
    });
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return sendError(res, 409, 'Account already exists', error.name);
    }
    console.error('POST /register failed:', error);
    return sendError(res, 500, 'Failed to register', error?.message);
  }
});

// Login user by email + plaintext password (for assignment simplicity).
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return sendError(res, 400, 'Missing required fields');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPassword = String(password);

    const data = await dynamodb.send(
      new GetCommand({
        TableName: LOGIN_TABLE_NAME,
        Key: { Email: normalizedEmail }
      })
    );

    const item = data?.Item;
    if (!item || item.Password !== normalizedPassword) {
      return sendError(res, 401, 'Invalid email or password');
    }

    return res.json({
      success: true,
      user: {
        email: normalizedEmail,
        username: item.UserName || ""
      }
    });
  } catch (error) {
    console.error('POST /login failed:', error);
    return sendError(res, 500, 'Failed to login', error?.message);
  }
});

function buildSongKey(artist, songTitle) {
  return `${String(artist).trim()}#${String(songTitle).trim()}`;
}

// Add a song to a user's subscription list.
app.post('/subscriptions/subscribe', async (req, res) => {
  try {
    const {
      userEmail,
      songKey: providedSongKey,
      artist,
      songTitle,
      album,
      year,
      image_url
    } = req.body || {};

    if (!userEmail || !artist || !songTitle) {
      return sendError(res, 400, 'Missing required fields');
    }

    const normalizedUserEmail = String(userEmail).trim().toLowerCase();
    const normalizedSongTitle = String(songTitle).trim();
    const normalizedArtist = String(artist).trim();
    const normalizedYear = year != null ? String(year) : "";

    const songKey = providedSongKey
      ? String(providedSongKey).trim()
      : buildSongKey(normalizedArtist, normalizedSongTitle);

    await dynamodb.send(
      new PutCommand({
        TableName: SUBSCRIPTIONS_TABLE_NAME,
        Item: {
          UserEmail: normalizedUserEmail,
          SongKey: songKey,
          Artist: normalizedArtist,
          SongTitle: normalizedSongTitle,
          Album: album != null ? String(album) : "",
          Year: normalizedYear,
          image_url: image_url != null ? String(image_url) : "",
          SubscribedAt: new Date().toISOString()
        },
        ConditionExpression: 'attribute_not_exists(SongKey)'
      })
    );

    return res.status(201).json({ success: true });
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return sendError(res, 409, 'Already subscribed', 'Subscription already exists');
    }
    console.error('POST /subscriptions/subscribe failed:', error);
    return sendError(res, 500, 'Failed to subscribe', error?.message);
  }
});

// Remove a song from a user's subscription list.
app.post('/subscriptions/unsubscribe', async (req, res) => {
  try {
    const { userEmail, songKey: providedSongKey, artist, songTitle } = req.body || {};

    if (!userEmail || !providedSongKey && (!artist || !songTitle)) {
      return sendError(res, 400, 'Missing required fields');
    }

    const normalizedUserEmail = String(userEmail).trim().toLowerCase();
    const songKey = providedSongKey
      ? String(providedSongKey).trim()
      : buildSongKey(artist, songTitle);

    await dynamodb.send(
      new DeleteCommand({
        TableName: SUBSCRIPTIONS_TABLE_NAME,
        Key: { UserEmail: normalizedUserEmail, SongKey: songKey }
      })
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('POST /subscriptions/unsubscribe failed:', error);
    return sendError(res, 500, 'Failed to unsubscribe', error?.message);
  }
});

// List a user's subscriptions.
app.get('/subscriptions', async (req, res) => {
  try {
    const userEmail = String(req.query.userEmail || "").trim().toLowerCase();
    if (!userEmail) {
      return sendError(res, 400, 'Missing userEmail query parameter');
    }

    const data = await dynamodb.send(
      new QueryCommand({
        TableName: SUBSCRIPTIONS_TABLE_NAME,
        KeyConditionExpression: '#u = :email',
        ExpressionAttributeNames: { '#u': 'UserEmail' },
        ExpressionAttributeValues: { ':email': userEmail }
      })
    );

    const items = (data?.Items || []).map((s) => ({
      id: `${s.Artist}-${s.SongTitle}`,
      title: s.SongTitle || "-",
      artist: s.Artist || "-",
      album: s.Album || "-",
      year: s.Year || "-",
      image: s.image_url || ""
    }));

    return res.json({ success: true, items });
  } catch (error) {
    console.error('GET /subscriptions failed:', error);
    return sendError(res, 500, 'Failed to list subscriptions', error?.message);
  }
});

// Search songs with AND-connected filter conditions.
// Query params: title, year, artist, album, limit, nextToken
app.get('/songs/search', async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    let exclusiveStartKey;
    if (req.query.nextToken) {
      try {
        exclusiveStartKey = decodePageToken(req.query.nextToken);
      } catch (tokenError) {
        return sendError(res, 400, 'Invalid pagination token', tokenError.message);
      }
    }

    const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
    const year = typeof req.query.year === "string" ? req.query.year.trim() : "";
    const artist = typeof req.query.artist === "string" ? req.query.artist.trim() : "";
    const album = typeof req.query.album === "string" ? req.query.album.trim() : "";

    const filterParts = [];
    const ExpressionAttributeNames = {};
    const ExpressionAttributeValues = {};

    if (title) {
      ExpressionAttributeNames['#st'] = 'SongTitle';
      ExpressionAttributeValues[':title'] = title;
      filterParts.push('contains(#st, :title)');
    }
    if (year) {
      ExpressionAttributeNames['#y'] = 'Year';
      ExpressionAttributeValues[':year'] = year;
      filterParts.push('contains(#y, :year)');
    }
    if (artist) {
      ExpressionAttributeNames['#a'] = 'Artist';
      ExpressionAttributeValues[':artist'] = artist;
      filterParts.push('contains(#a, :artist)');
    }
    if (album) {
      ExpressionAttributeNames['#al'] = 'Album';
      ExpressionAttributeValues[':album'] = album;
      filterParts.push('contains(#al, :album)');
    }

    if (filterParts.length === 0) {
      return sendError(
        res,
        400,
        'At least one search field must be provided',
        'Provide title, year, artist, and/or album'
      );
    }

    const data = await dynamodb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
        FilterExpression: filterParts.join(' AND '),
        ExpressionAttributeNames,
        ExpressionAttributeValues
      })
    );

    const nextToken = encodePageToken(data.LastEvaluatedKey);

    return res.json({
      success: true,
      items: data.Items || [],
      pagination: {
        limit,
        nextToken,
        hasNextPage: Boolean(nextToken)
      }
    });
  } catch (error) {
    console.error('GET /songs/search failed:', error);
    return sendError(res, 500, 'Failed to search songs', error.message);
  }
});

// Fetch table-level stats using exact count scan.
app.get('/songs/stats', async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.pageSize, 10);
    const pageSize = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    let totalSongs = 0;
    let exclusiveStartKey;

    do {
      const countPage = await dynamodb.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          Select: 'COUNT',
          ExclusiveStartKey: exclusiveStartKey
        })
      );

      totalSongs += countPage.Count || 0;
      exclusiveStartKey = countPage.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const totalPages = Math.max(1, Math.ceil(totalSongs / pageSize));

    return res.json({
      success: true,
      stats: {
        totalSongs,
        totalPages,
        pageSize,
        isApproximate: false
      }
    });
  } catch (error) {
    console.error('GET /songs/stats failed:', error);
    return sendError(res, 500, 'Failed to fetch song statistics', error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using DynamoDB table "${TABLE_NAME}"`);
});
