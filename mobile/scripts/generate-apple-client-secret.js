// Usage:
//   TEAM_ID=XXXXX KEY_ID=YYYYY CLIENT_ID=com.footytrail.signin PRIVATE_KEY_PATH=./AuthKey_YYYYY.p8 node scripts/generate-apple-client-secret.js
//
// The script prints the client secret JWT to stdout. Paste that into Supabase → Auth → Providers → Apple → "Secret Key (for OAuth)".

import fs from "node:fs";
import { importPKCS8, SignJWT } from "jose";

const TEAM_ID = process.env.TEAM_ID;          // Apple Team ID (e.g. 5WA2M6S78H)
const KEY_ID = process.env.KEY_ID;            // Apple Key ID
const CLIENT_ID = process.env.CLIENT_ID;      // Services ID (e.g. com.footytrail.signin)
const PRIVATE_KEY_PATH = process.env.PRIVATE_KEY_PATH; // path to your .p8 file

if (!TEAM_ID || !KEY_ID || !CLIENT_ID || !PRIVATE_KEY_PATH) {
  console.error("Missing env. Provide TEAM_ID, KEY_ID, CLIENT_ID, PRIVATE_KEY_PATH.");
  process.exit(1);
}

const privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");

// Apple requires ES256
const alg = "ES256";
const now = Math.floor(Date.now() / 1000);

// Apple allows max 6 months validity. We'll use ~180 days (15552000s).
const exp = now + 15552000;

const run = async () => {
  const key = await importPKCS8(privateKeyPem, alg);
  const jwt = await new SignJWT({
    iss: TEAM_ID,              // your Apple Team ID
    iat: now,
    exp,
    aud: "https://appleid.apple.com",
    sub: CLIENT_ID,            // your Services ID (client_id)
  })
    .setProtectedHeader({ alg, kid: KEY_ID })
    .sign(key);

  console.log(jwt);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
