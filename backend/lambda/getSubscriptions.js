const {
  buildResponse,
  sendError,
  dynamodb,
  QueryCommand,
  SUBSCRIPTIONS_TABLE_NAME,
  decodePageToken,
  encodePageToken,
  toSignedImageUrl,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE
} = require('./shared');

exports.handler = async (event) => {
  try {
    if (event?.httpMethod === 'OPTIONS') {
      return buildResponse(200, { success: true });
    }

    const qs = event?.queryStringParameters || {};
    const userEmail = String(qs.userEmail || '').trim().toLowerCase();
    if (!userEmail) {
      return sendError(400, 'Missing userEmail query parameter');
    }

    const requestedLimit = Number.parseInt(qs.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    let offset = 0;
    if (qs.nextToken) {
      const decodedToken = decodePageToken(qs.nextToken);
      const parsedOffset = Number.parseInt(decodedToken?.offset, 10);
      if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
        return sendError(400, 'Invalid pagination token', 'Invalid offset in token');
      }
      offset = parsedOffset;
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
          title: s.SongTitle || '-',
          artist: s.Artist || '-',
          album: s.Album || '-',
          year: s.Year || '-',
          image: imageSignedUrl || '',
          imageKey: imageKey || ''
        };
      })
    );

    return buildResponse(200, {
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
    console.error('music-get-subs failed:', error);
    return sendError(500, 'Failed to list subscriptions', error?.message);
  }
};
