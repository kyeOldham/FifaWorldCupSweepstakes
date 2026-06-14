import { getStore } from "@netlify/blobs";

// Pulls live World Cup 2026 results from the free, keyless worldcup26.ir API and
// maps them onto the sweepstake's data model, writing into the shared Blobs store.
const API_BASE = "https://worldcup26.ir";

// App team name -> API `name_en` (only the names that differ; the rest match exactly)
const ALIAS = {
  "USA": "United States",
  "Türkiye": "Turkey",
  "Czechia": "Czech Republic",
  "DR Congo": "Democratic Republic of the Congo",
  "Bosnia & Herzegovina": "Bosnia and Herzegovina",
};
const toApiName = (appName) => ALIAS[appName] || appName;

// Knockout stage -> rank, so we can pick the furthest round a team has reached.
// 'third' (3rd-place playoff) means the team lost its semi, i.e. reached the SF.
const STAGE_RANK = { group: 0, r32: 1, r16: 2, qf: 3, sf: 4, third: 4, final: 5 };
const RANK_TO_ROUND = ["group", "r32", "r16", "qf", "sf", "final"]; // champion handled separately

const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const isFinished = (g) => String(g.finished).toUpperCase() === "TRUE";

// Derive { games, round, goals } for one team (by API name) from the full games list.
function deriveTeam(apiName, games) {
  const mine = games.filter((g) => g.home_team_name_en === apiName || g.away_team_name_en === apiName);
  // Returns [teamScore, opponentScore] from this team's perspective
  const sideScore = (g) => g.home_team_name_en === apiName
    ? [num(g.home_score), num(g.away_score)]
    : [num(g.away_score), num(g.home_score)];

  // Group stage W/D/L by matchday (1..3 -> index 0..2); unplayed stays null
  const grp = [null, null, null];
  for (const g of mine) {
    if (g.type !== "group" || !isFinished(g)) continue;
    const idx = num(g.matchday) - 1;
    if (idx < 0 || idx > 2) continue;
    const [me, them] = sideScore(g);
    grp[idx] = me > them ? "W" : me < them ? "L" : "D";
  }

  // Goals scored across all finished matches (group + knockout)
  let goals = 0;
  for (const g of mine) if (isFinished(g)) goals += sideScore(g)[0];

  // Furthest round reached: highest stage the team is named in. Being listed in a
  // knockout fixture (even before it's played) means they advanced to it.
  let rank = 0;
  let finalGame = null;
  for (const g of mine) {
    const r = STAGE_RANK[g.type];
    if (r === undefined) continue;
    if (r > rank) rank = r;
    if (g.type === "final") finalGame = g;
  }
  let round = RANK_TO_ROUND[rank] || "group";
  if (finalGame && isFinished(finalGame)) {
    const [me, them] = sideScore(finalGame);
    round = me > them ? "champion" : "final";
  }

  return { games: grp, round, goals };
}

export async function runSync() {
  const store = getStore("sweepstake");

  // Preserve the existing draw + countGoals; only results are derived from the API
  const rec = await store.get("state", { type: "json" });
  const state = rec && rec.value ? JSON.parse(rec.value) : null;
  if (!state || !state.draw) return { ok: true, skipped: "no draw yet", teams: 0 };

  const res = await fetch(`${API_BASE}/get/games`);
  if (!res.ok) return { ok: false, error: `games fetch failed (${res.status})` };
  const data = await res.json();
  const games = Array.isArray(data) ? data : (data.games || []);

  // Every team that appears in the draw
  const drawn = new Set();
  for (const player of Object.keys(state.draw)) {
    for (const pot of Object.keys(state.draw[player])) drawn.add(state.draw[player][pot]);
  }

  const results = { ...(state.results || {}) };
  for (const appName of drawn) results[appName] = deriveTeam(toApiName(appName), games);

  const next = { ...state, results };
  await store.setJSON("state", { value: JSON.stringify(next), version: Date.now() });

  return {
    ok: true,
    teams: drawn.size,
    finishedGames: games.filter(isFinished).length,
    syncedAt: new Date().toISOString(),
  };
}
