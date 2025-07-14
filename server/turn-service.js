const dotenv = require("dotenv");
dotenv.config();

// server/turn-service.js
const accountSid = process.env.AccountSID;
const authToken = process.env.AuthToken;

const client = require("twilio")(accountSid, authToken);

async function getTURNCredentials() {
  try {
    const token = await client.tokens.create();

    return {
      username: token.username,
      password: token.password,
      urls: token.iceServers
        .filter((server) => server.url.startsWith("turn"))
        .map((server) => server.url),
    };
  } catch (error) {
    console.error("Erreur Twilio:", error);
    return null;
  }
}

module.exports = { getTURNCredentials };
