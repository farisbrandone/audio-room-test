// server/turn-service.js
const accountSid = process.env.accountSid;
const authToken = process.env.authToken;
const client = require("twilio")(accountSid, authToken);

async function getTURNCredentials() {
  try {
    const token = await client.tokens.create();
    console.log({
      username: token.username,
      password: token.password,
      urls: token.iceServers
        .filter((server) => server.url.startsWith("turn"))
        .map((server) => server.url),
    });
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
