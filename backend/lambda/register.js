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
      // browsers send this before the real request when the site is on another domain
      return buildResponse(200, { success: true });
    }

    const { username, email, password } = parseJsonBody(event);

    if (!username || !email || !password) {
      return sendError(400, 'All fields are required.');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUserName = String(username).trim();
    const normalizedPassword = String(password);
    const createdAt = new Date().toISOString(); // just so we know when the account showed up

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
        // bail if that email row already exists — stops silent overwrites
        ConditionExpression: 'attribute_not_exists(Email)'
      })
    );

    return buildResponse(201, {
      success: true,
      user: { email: normalizedEmail, username: normalizedUserName }
    });
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      // dynamo throws this when the email key was already there
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

