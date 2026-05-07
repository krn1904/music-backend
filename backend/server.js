const express = require('express');
const cors = require('cors');
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
const S3_BUCKET = process.env.S3_BUCKET || '';
const IMAGE_URL_TTL_SECONDS = Number.parseInt(process.env.S3_SIGNED_URL_TTL_SECONDS || '900', 10);
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;
const SUBSCRIPTIONS_PAGE_SIZE = 10;

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

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN
  }
});

function looksLikeHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

async function toSignedImageUrl(imageUrlOrKey) {
  const raw = typeof imageUrlOrKey === 'string' ? imageUrlOrKey.trim() : '';
  if (!raw) return { imageKey: '', imageSignedUrl: '' };

  // Back-compat: if the table still contains the original remote URL, just use it.
  if (looksLikeHttpUrl(raw)) {
    return { imageKey: '', imageSignedUrl: raw };
  }

  // Expected new format: image_url is an S3 object key in S3_BUCKET
  if (!S3_BUCKET) {
    return { imageKey: raw, imageSignedUrl: '' };
  }

  const safeTtl = Number.isFinite(IMAGE_URL_TTL_SECONDS) && IMAGE_URL_TTL_SECONDS > 0
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
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf-8').toString('base64');
}

// Fetch all songs from the table
app.get('/songs', async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
      : SUBSCRIPTIONS_PAGE_SIZE;

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

    const items = await Promise.all(
      (data.Items || []).map(async (item) => {
        const { imageKey, imageSignedUrl } = await toSignedImageUrl(item?.image_url);
        return {
          ...item,
          image_url: imageKey || item?.image_url || '',
          image_signed_url: imageSignedUrl || ''
        };
      })
    );

    return res.json({
      success: true,
      items,
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
      return sendError(res, 400, 'All fields are required.');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUserName = String(username).trim();
    const normalizedPassword = String(password);
    const createdAt = new Date().toISOString();

    if (!normalizedEmail.includes('@')) {
      return sendError(res, 400, 'Please enter a valid email address.');
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
      return sendError(res, 409, 'The email already exists', error.name);
    }
    console.error('POST /register failed:', error);
    return sendError(res, 500, 'Unable to create account. Please try again.', error?.message);
  }
});

// Login user by email + plaintext password (for assignment simplicity).
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return sendError(res, 400, 'Email and password are required.');
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
      return sendError(res, 401, 'email or password is invalid');
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
    return sendError(res, 500, 'Unable to log in. Please try again.', error?.message);
  }
});

// Subscription SongKey is a 3-part composite (Artist#SongTitle#Year) so
// legitimate re-releases (e.g. Taylor Swift "Delicate" 2017 vs 2018) can be
// subscribed/unsubscribed independently. Server-side construction is the
// single source of truth; any client-supplied songKey is ignored.
function buildSongKey(artist, songTitle, year) {
  return `${String(artist).trim()}#${String(songTitle).trim()}#${String(year || '').trim()}`;
}

// Add a song to a user's subscription list.
app.post('/subscriptions/subscribe', async (req, res) => {
  try {
    const {
      userEmail,
      artist,
      songTitle,
      album,
      year,
      image_url
    } = req.body || {};

    if (!userEmail || !artist || !songTitle || year == null || String(year).trim() === '') {
      return sendError(res, 400, 'Missing required fields (userEmail, artist, songTitle, year)');
    }

    const normalizedUserEmail = String(userEmail).trim().toLowerCase();
    const normalizedSongTitle = String(songTitle).trim();
    const normalizedArtist = String(artist).trim();
    const normalizedYear = String(year).trim();

    const songKey = buildSongKey(normalizedArtist, normalizedSongTitle, normalizedYear);

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
          // Store the S3 key (not a presigned URL). If a URL is provided, store it as-is.
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
    const { userEmail, artist, songTitle, year } = req.body || {};

    if (!userEmail || !artist || !songTitle || year == null || String(year).trim() === '') {
      return sendError(res, 400, 'Missing required fields (userEmail, artist, songTitle, year)');
    }

    const normalizedUserEmail = String(userEmail).trim().toLowerCase();
    const songKey = buildSongKey(artist, songTitle, year);

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

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    let offset = 0;
    if (req.query.nextToken) {
      try {
        const decodedToken = decodePageToken(req.query.nextToken);
        const parsedOffset = Number.parseInt(decodedToken?.offset, 10);
        if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
          return sendError(res, 400, 'Invalid pagination token', 'Invalid offset in token');
        }
        offset = parsedOffset;
      } catch (tokenError) {
        return sendError(res, 400, 'Invalid pagination token', tokenError.message);
      }
    }

    const allItems = [];
    let queryExclusiveStartKey;
    do {
      const page = await dynamodb.send(
        new QueryCommand({
          TableName: SUBSCRIPTIONS_TABLE_NAME,
          KeyConditionExpression: '#u = :email',
          ExpressionAttributeNames: { '#u': 'UserEmail' },
          ExpressionAttributeValues: { ':email': userEmail },
          ExclusiveStartKey: queryExclusiveStartKey
        })
      );

      allItems.push(...(page?.Items || []));
      queryExclusiveStartKey = page.LastEvaluatedKey;
    } while (queryExclusiveStartKey);

    const sortedItems = allItems.sort((a, b) => {
      const aTime = Date.parse(a?.SubscribedAt || '');
      const bTime = Date.parse(b?.SubscribedAt || '');
      const safeATime = Number.isFinite(aTime) ? aTime : 0;
      const safeBTime = Number.isFinite(bTime) ? bTime : 0;
      return safeBTime - safeATime;
    });

    const totalSubscriptions = sortedItems.length;
    const pagedItems = sortedItems.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    const nextToken = nextOffset < totalSubscriptions
      ? encodePageToken({ offset: nextOffset })
      : null;

    const items = await Promise.all(
      pagedItems.map(async (s) => {
        const { imageKey, imageSignedUrl } = await toSignedImageUrl(s?.image_url);
        return {
          id: `${s.Artist}-${s.SongTitle}`,
          title: s.SongTitle || "-",
          artist: s.Artist || "-",
          album: s.Album || "-",
          year: s.Year || "-",
          image: imageSignedUrl || "",
          imageKey: imageKey || ""
        };
      })
    );

    return res.json({
      success: true,
      items,
      pagination: {
        limit,
        nextToken,
        hasNextPage: Boolean(nextToken),
        totalSongs: totalSubscriptions,
        totalPages: Math.max(1, Math.ceil(totalSubscriptions / limit)),
        isTotalApproximate: false
      }
    });
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

    // Use offset pagination for filtered scans so pagination remains correct
    // even when a single DynamoDB Scan page contains more matches than `limit`.
    let offset = 0;
    if (req.query.nextToken) {
      try {
        const decodedToken = decodePageToken(req.query.nextToken);
        const parsedOffset = Number.parseInt(decodedToken?.offset, 10);
        if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
          return sendError(res, 400, 'Invalid pagination token', 'Invalid offset in token');
        }
        offset = parsedOffset;
      } catch (tokenError) {
        return sendError(res, 400, 'Invalid pagination token', tokenError.message);
      }
    }

    const matchedItems = [];
    let scanExclusiveStartKey;
    do {
      const page = await dynamodb.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          ExclusiveStartKey: scanExclusiveStartKey,
          FilterExpression: filterParts.join(' AND '),
          ExpressionAttributeNames,
          ExpressionAttributeValues
        })
      );

      if (Array.isArray(page.Items) && page.Items.length > 0) {
        matchedItems.push(...page.Items);
      }

      scanExclusiveStartKey = page.LastEvaluatedKey;
    } while (scanExclusiveStartKey);

    const totalSongs = matchedItems.length;
    const pagedItems = matchedItems.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    const nextToken = nextOffset < totalSongs
      ? encodePageToken({ offset: nextOffset })
      : null;

    const totalPages = Math.max(1, Math.ceil(totalSongs / limit));

    const items = await Promise.all(
      pagedItems.map(async (item) => {
        const { imageKey, imageSignedUrl } = await toSignedImageUrl(item?.image_url);
        return {
          ...item,
          image_url: imageKey || item?.image_url || '',
          image_signed_url: imageSignedUrl || ''
        };
      })
    );

    return res.json({
      success: true,
      items,
      pagination: {
        limit,
        totalSongs,
        totalPages,
        isTotalApproximate: false,
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

// Query the LSI AlbumIndex (PK: Artist, SK: Album).
// Returns all songs for a given artist on a given album in a single Query
// (no Scan, no client-side filter). Demonstrates purposeful LSI usage.
app.get('/songs/by-album', async (req, res) => {
  try {
    const artist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
    const album = typeof req.query.album === 'string' ? req.query.album.trim() : '';

    if (!artist || !album) {
      return sendError(res, 400, 'Missing required query params: artist and album');
    }

    const data = await dynamodb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'AlbumIndex',
        KeyConditionExpression: '#a = :artist AND #al = :album',
        ExpressionAttributeNames: { '#a': 'Artist', '#al': 'Album' },
        ExpressionAttributeValues: { ':artist': artist, ':album': album }
      })
    );

    const items = await Promise.all(
      (data.Items || []).map(async (item) => {
        const { imageKey, imageSignedUrl } = await toSignedImageUrl(item?.image_url);
        return {
          ...item,
          image_url: imageKey || item?.image_url || '',
          image_signed_url: imageSignedUrl || ''
        };
      })
    );

    return res.json({
      success: true,
      items,
      meta: {
        index: 'AlbumIndex',
        operation: 'Query',
        count: items.length
      }
    });
  } catch (error) {
    console.error('GET /songs/by-album failed:', error);
    return sendError(res, 500, 'Failed to query by album', error.message);
  }
});

// Query the GSI YearArtistIndex (PK: Year, SK: Artist).
// Returns all songs released in a given year, optionally filtered by an
// artist prefix using begins_with on the SK. Demonstrates purposeful GSI
// usage and Query (not Scan) for year-based access patterns.
app.get('/songs/by-year', async (req, res) => {
  try {
    const year = typeof req.query.year === 'string' ? req.query.year.trim() : '';
    const artist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';

    if (!year) {
      return sendError(res, 400, 'Missing required query param: year');
    }

    const ExpressionAttributeNames = { '#y': 'Year' };
    const ExpressionAttributeValues = { ':year': year };
    let KeyConditionExpression = '#y = :year';

    if (artist) {
      ExpressionAttributeNames['#a'] = 'Artist';
      ExpressionAttributeValues[':artist'] = artist;
      KeyConditionExpression += ' AND begins_with(#a, :artist)';
    }

    const data = await dynamodb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'YearArtistIndex',
        KeyConditionExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues
      })
    );

    const items = await Promise.all(
      (data.Items || []).map(async (item) => {
        const { imageKey, imageSignedUrl } = await toSignedImageUrl(item?.image_url);
        return {
          ...item,
          image_url: imageKey || item?.image_url || '',
          image_signed_url: imageSignedUrl || ''
        };
      })
    );

    return res.json({
      success: true,
      items,
      meta: {
        index: 'YearArtistIndex',
        operation: 'Query',
        count: items.length
      }
    });
  } catch (error) {
    console.error('GET /songs/by-year failed:', error);
    return sendError(res, 500, 'Failed to query by year', error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using DynamoDB table "${TABLE_NAME}"`);
});
