const {
  buildResponse,
  sendError,
  dynamodb,
  ScanCommand,
  QueryCommand,
  TABLE_NAME,
  decodePageToken,
  encodePageToken,
  toSignedImageUrl,
  getPath,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE
} = require('./shared');

async function handleSongs(event) {
  const qs = event?.queryStringParameters || {};

  const requestedLimit = Number.parseInt(qs.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  let exclusiveStartKey;
  if (qs.nextToken) {
    exclusiveStartKey = decodePageToken(qs.nextToken);
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

  return buildResponse(200, {
    success: true,
    items,
    pagination: {
      limit,
      nextToken,
      hasNextPage: Boolean(nextToken)
    }
  });
}

async function handleSearch(event) {
  const qs = event?.queryStringParameters || {};

  const requestedLimit = Number.parseInt(qs.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  const title = typeof qs.title === 'string' ? qs.title.trim() : '';
  const year = typeof qs.year === 'string' ? qs.year.trim() : '';
  const artist = typeof qs.artist === 'string' ? qs.artist.trim() : '';
  const album = typeof qs.album === 'string' ? qs.album.trim() : '';

  const normalizedTitle = title.toLowerCase();
  const normalizedYear = year.toLowerCase();
  const normalizedArtist = artist.toLowerCase();
  const normalizedAlbum = album.toLowerCase();

  const hasAnyFilter = Boolean(
    normalizedTitle || normalizedYear || normalizedArtist || normalizedAlbum
  );
  if (!hasAnyFilter) {
    return sendError(
      400,
      'At least one search field must be provided',
      'Provide title, year, artist, and/or album'
    );
  }

  let offset = 0;
  if (qs.nextToken) {
    const decodedToken = decodePageToken(qs.nextToken);
    const parsedOffset = Number.parseInt(decodedToken?.offset, 10);
    if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
      return sendError(400, 'Invalid pagination token', 'Invalid offset in token');
    }
    offset = parsedOffset;
  }

  const matchedItems = [];
  let scanExclusiveStartKey;
  do {
    const page = await dynamodb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ExclusiveStartKey: scanExclusiveStartKey
      })
    );

    if (Array.isArray(page.Items) && page.Items.length > 0) {
      const filteredItems = page.Items.filter((item) => {
        const itemTitle = String(item?.SongTitle || '').toLowerCase();
        const itemYear = String(item?.Year || '').toLowerCase();
        const itemArtist = String(item?.Artist || '').toLowerCase();
        const itemAlbum = String(item?.Album || '').toLowerCase();

        if (normalizedTitle && !itemTitle.includes(normalizedTitle)) return false;
        if (normalizedYear && !itemYear.includes(normalizedYear)) return false;
        if (normalizedArtist && !itemArtist.includes(normalizedArtist)) return false;
        if (normalizedAlbum && !itemAlbum.includes(normalizedAlbum)) return false;

        return true;
      });
      matchedItems.push(...filteredItems);
    }

    scanExclusiveStartKey = page.LastEvaluatedKey;
  } while (scanExclusiveStartKey);

  const totalSongs = matchedItems.length;
  const pagedItems = matchedItems.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const nextToken =
    nextOffset < totalSongs ? encodePageToken({ offset: nextOffset }) : null;

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

  return buildResponse(200, {
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
}

async function handleStats(event) {
  const qs = event?.queryStringParameters || {};

  const requestedLimit = Number.parseInt(qs.pageSize, 10);
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

  return buildResponse(200, {
    success: true,
    stats: {
      totalSongs,
      totalPages,
      pageSize,
      isApproximate: false
    }
  });
}

async function handleByAlbum(event) {
  const qs = event?.queryStringParameters || {};

  const artist = typeof qs.artist === 'string' ? qs.artist.trim() : '';
  const album = typeof qs.album === 'string' ? qs.album.trim() : '';

  if (!artist || !album) {
    return sendError(400, 'Missing required query params: artist and album');
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

  return buildResponse(200, {
    success: true,
    items,
    meta: {
      index: 'AlbumIndex',
      operation: 'Query',
      count: items.length
    }
  });
}

async function handleByYear(event) {
  const qs = event?.queryStringParameters || {};

  const year = typeof qs.year === 'string' ? qs.year.trim() : '';
  const artist = typeof qs.artist === 'string' ? qs.artist.trim() : '';

  if (!year) {
    return sendError(400, 'Missing required query param: year');
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

  return buildResponse(200, {
    success: true,
    items,
    meta: {
      index: 'YearArtistIndex',
      operation: 'Query',
      count: items.length
    }
  });
}

exports.handler = async (event) => {
  try {
    if (event?.httpMethod === 'OPTIONS') {
      return buildResponse(200, { success: true });
    }

    const path = getPath(event);

    if (path === '/songs') return await handleSongs(event);
    if (path === '/songs/search') return await handleSearch(event);
    if (path === '/songs/stats') return await handleStats(event);
    if (path === '/songs/by-album') return await handleByAlbum(event);
    if (path === '/songs/by-year') return await handleByYear(event);

    return sendError(404, `Unknown route: ${path}`);
  } catch (error) {
    console.error('music-query-songs failed:', error);
    return sendError(500, 'Failed to query songs', error?.message);
  }
};

