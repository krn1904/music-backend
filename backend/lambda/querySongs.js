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
  // clamp limit so one request can't ask for a ridiculous page size
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  let exclusiveStartKey;
  if (qs.nextToken) {
    // pick up where the last page left off (Dynamo's cursor)
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
      // presign images so the UI can show them without exposing the bucket
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
  // same page-size clamp as the songs list
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

  // need at least one field or we'd just be scanning everything for no reason
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
    // search materializes all matches first — token is just an offset into that array
    const decodedToken = decodePageToken(qs.nextToken);
    const parsedOffset = Number.parseInt(decodedToken?.offset, 10);
    if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
      return sendError(400, 'Invalid pagination token', 'Invalid offset in token');
    }
    offset = parsedOffset;
  }

  const matchedItems = [];
  let scanExclusiveStartKey;
  // walk the whole table in chunks — simple search, not great at massive scale
  do {
    const page = await dynamodb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ExclusiveStartKey: scanExclusiveStartKey
      })
    );

    if (Array.isArray(page.Items) && page.Items.length > 0) {
      // loose "contains" checks — good enough for the assignment dataset
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
  // slice the in-memory matches for "page 2" etc. (token stores offset)
  const pagedItems = matchedItems.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const nextToken =
    nextOffset < totalSongs ? encodePageToken({ offset: nextOffset }) : null;

  const totalPages = Math.max(1, Math.ceil(totalSongs / limit));

  const items = await Promise.all(
    pagedItems.map(async (item) => {
      // same image handling as browse — key in json, signed url for <img src>
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
  // stats endpoint still respects the shared max so someone can't DOS with a weird pageSize
  const pageSize = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  let totalSongs = 0;
  let exclusiveStartKey;

  // COUNT scans are lighter — we only need how many rows exist, not the data
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

  const requestedLimit = Number.parseInt(qs.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  let exclusiveStartKey;
  if (qs.nextToken) {
    exclusiveStartKey = decodePageToken(qs.nextToken);
  }

  // LSI lookup — way faster than scanning when you know artist + album
  const data = await dynamodb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'AlbumIndex',
      KeyConditionExpression: '#a = :artist AND #al = :album',
      ExpressionAttributeNames: { '#a': 'Artist', '#al': 'Album' },
      ExpressionAttributeValues: { ':artist': artist, ':album': album },
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
      totalSongs: items.length,
      nextToken,
      isTotalApproximate: Boolean(nextToken)
    },
    meta: {
      index: 'AlbumIndex',
      operation: 'Query'
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

  const requestedLimit = Number.parseInt(qs.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  let exclusiveStartKey;
  if (qs.nextToken) {
    exclusiveStartKey = decodePageToken(qs.nextToken);
  }

  // Query DynamoDB by year only — artist filtering is done in JS below so
  // partial and case-insensitive artist searches work (DynamoDB begins_with
  // is case-sensitive and doesn't support partial matching).
  const data = await dynamodb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'YearArtistIndex',
      KeyConditionExpression: '#y = :year',
      ExpressionAttributeNames: { '#y': 'Year' },
      ExpressionAttributeValues: { ':year': year },
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey
    })
  );

  const nextToken = encodePageToken(data.LastEvaluatedKey);

  const normalizedArtist = artist.toLowerCase();

  const allItems = await Promise.all(
    (data.Items || []).map(async (item) => {
      const { imageKey, imageSignedUrl } = await toSignedImageUrl(item?.image_url);
      return {
        ...item,
        image_url: imageKey || item?.image_url || '',
        image_signed_url: imageSignedUrl || ''
      };
    })
  );

  // Case-insensitive partial match on artist — "tay" matches "Taylor Swift"
  const items = artist
    ? allItems.filter((item) =>
        String(item.Artist || '').toLowerCase().includes(normalizedArtist)
      )
    : allItems;

  return buildResponse(200, {
    success: true,
    items,
    pagination: {
      limit,
      totalSongs: items.length,
      nextToken,
      isTotalApproximate: Boolean(nextToken)
    },
    meta: {
      index: 'YearArtistIndex',
      operation: 'Query'
    }
  });
}

exports.handler = async (event) => {
  try {
    if (event?.httpMethod === 'OPTIONS') {
      return buildResponse(200, { success: true });
    }

    // same lambda, different paths — API Gateway just forwards the route
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

