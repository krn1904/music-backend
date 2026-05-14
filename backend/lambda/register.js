const {
  buildResponse,
  sendError,
  parseJsonBody,
  dynamodb,
  PutCommand,
  LOGIN_TABLE_NAME
} = require('./shared');

exports.handler = async (event) => {
  try {
    if (event?.httpMethod === 'OPTIONS') {
      return buildResponse(200, { success: true });
    }

    const { username, email, password } = parseJsonBody(event);

    if (!username || !email || !password) {
      return sendError(400, 'All fields are required.');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUserName = String(username).trim();
    const normalizedPassword = String(password);
    const createdAt = new Date().toISOString();

    if (!normalizedEmail.includes('@')) {
      return sendError(400, 'Please enter a valid email address.');
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
        ConditionExpression: 'attribute_not_exists(Email)'
      })
    );

    return buildResponse(201, {
      success: true,
      user: { email: normalizedEmail, username: normalizedUserName }
    });
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return sendError(409, 'The email already exists', error.name);
    }
    console.error('music-register failed:', error);
    return sendError(
      500,
      'Unable to create account. Please try again.',
      error?.message
    );
  }
};

