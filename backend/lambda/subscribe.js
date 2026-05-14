const {
  buildResponse,
  sendError,
  parseJsonBody,
  dynamodb,
  PutCommand,
  SUBSCRIPTIONS_TABLE_NAME,
  buildSongKey
} = require('./shared');

exports.handler = async (event) => {
  try {
    if (event?.httpMethod === 'OPTIONS') {
      return buildResponse(200, { success: true });
    }

    const { userEmail, artist, songTitle, album, year, image_url } =
      parseJsonBody(event);

    if (
      !userEmail ||
      !artist ||
      !songTitle ||
      year == null ||
      String(year).trim() === ''
    ) {
      return sendError(
        400,
        'Missing required fields (userEmail, artist, songTitle, year)'
      );
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
          Album: album != null ? String(album) : '',
          Year: normalizedYear,
          image_url: image_url != null ? String(image_url) : '',
          SubscribedAt: new Date().toISOString()
        },
        ConditionExpression: 'attribute_not_exists(SongKey)'
      })
    );

    return buildResponse(201, { success: true });
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return sendError(409, 'Already subscribed', 'Subscription already exists');
    }
    console.error('music-subscribe failed:', error);
    return sendError(500, 'Failed to subscribe', error?.message);
  }
};
