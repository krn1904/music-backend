const {
  buildResponse,
  sendError,
  parseJsonBody,
  dynamodb,
  DeleteCommand,
  SUBSCRIPTIONS_TABLE_NAME,
  buildSongKey
} = require('./shared');

exports.handler = async (event) => {
  try {
    if (event?.httpMethod === 'OPTIONS') {
      return buildResponse(200, { success: true });
    }

    const { userEmail, artist, songTitle, year } = parseJsonBody(event);

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
    const songKey = buildSongKey(artist, songTitle, year);

    await dynamodb.send(
      new DeleteCommand({
        TableName: SUBSCRIPTIONS_TABLE_NAME,
        Key: { UserEmail: normalizedUserEmail, SongKey: songKey }
      })
    );

    return buildResponse(200, { success: true });
  } catch (error) {
    console.error('music-unsubscribe failed:', error);
    return sendError(500, 'Failed to unsubscribe', error?.message);
  }
};
