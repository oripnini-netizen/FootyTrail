export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "https://footytrail-api.example.com";

async function j(url, opts) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function getCompetitions() {
  return j(`${API_BASE}/competitions`);
}

export async function getSeasons() {
  return j(`${API_BASE}/seasons`);
}

export async function getCounts(payload) {
  return j(`${API_BASE}/counts`, { method: "POST", body: JSON.stringify(payload) });
}

export async function getRandomPlayer(payload, userId) {
  return j(`${API_BASE}/random-player`, { method: "POST", body: JSON.stringify({ ...payload, userId }) });
}

export async function getDailyChallenge() {
  return j(`${API_BASE}/daily`);
}

export async function getLimits(userId) {
  return j(`${API_BASE}/limits?userId=${encodeURIComponent(userId)}`);
}
