const {
  buildResponse,
  sendError,
  parseJsonBody,
  dynamodb,
  GetCommand,
  LOGIN_TABLE_NAME
} = require('./shared');

exports.handler = async (event) => {
  try {
    if (event?.httpMethod === 'OPTIONS') {
      return buildResponse(200, { success: true });
    }

    const { email, password } = parseJsonBody(event);

    if (!email || !password) {
      return sendError(400, 'Email and password are required.');
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
      return sendError(401, 'email or password is invalid');
    }

    return buildResponse(200, {
      success: true,
      user: {
        email: normalizedEmail,
        username: item.UserName || ''
      }
    });
  } catch (error) {
    console.error('music-login failed:', error);
    return sendError(500, 'Unable to log in. Please try again.', error?.message);
  }
};

