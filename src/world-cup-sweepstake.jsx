import React, { useState, useEffect, useMemo, useRef } from "react";
import { Trophy, Shuffle, Goal, ChevronRight, Lock, RefreshCw } from "lucide-react";
import { loadState, saveState, pollState } from "./sharedStore";

// ---- Tournament data: the four FIFA 2026 seeding pots (48 teams) ----
const POTS = {
  1: ["Canada", "Mexico", "USA", "Spain", "Argentina", "France", "England", "Brazil", "Portugal", "Netherlands", "Belgium", "Germany"],
  2: ["Croatia", "Morocco", "Colombia", "Uruguay", "Switzerland", "Japan", "Senegal", "Iran", "South Korea", "Ecuador", "Austria", "Australia"],
  3: ["Norway", "Panama", "Egypt", "Algeria", "Scotland", "Paraguay", "Tunisia", "Ivory Coast", "Uzbekistan", "Qatar", "Saudi Arabia", "South Africa"],
  4: ["Jordan", "Cape Verde", "Ghana", "Curaçao", "Haiti", "New Zealand", "Bosnia & Herzegovina", "Sweden", "Türkiye", "Czechia", "Iraq", "DR Congo"],
};

const FLAGS = {
  Canada: "🇨🇦", Mexico: "🇲🇽", USA: "🇺🇸", Spain: "🇪🇸", Argentina: "🇦🇷", France: "🇫🇷",
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", Brazil: "🇧🇷", Portugal: "🇵🇹", Netherlands: "🇳🇱", Belgium: "🇧🇪", Germany: "🇩🇪",
  Croatia: "🇭🇷", Morocco: "🇲🇦", Colombia: "🇨🇴", Uruguay: "🇺🇾", Switzerland: "🇨🇭", Japan: "🇯🇵",
  Senegal: "🇸🇳", Iran: "🇮🇷", "South Korea": "🇰🇷", Ecuador: "🇪🇨", Austria: "🇦🇹", Australia: "🇦🇺",
  Norway: "🇳🇴", Panama: "🇵🇦", Egypt: "🇪🇬", Algeria: "🇩🇿", Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", Paraguay: "🇵🇾",
  Tunisia: "🇹🇳", "Ivory Coast": "🇨🇮", Uzbekistan: "🇺🇿", Qatar: "🇶🇦", "Saudi Arabia": "🇸🇦", "South Africa": "🇿🇦",
  Jordan: "🇯🇴", "Cape Verde": "🇨🇻", Ghana: "🇬🇭", "Curaçao": "🇨🇼", Haiti: "🇭🇹", "New Zealand": "🇳🇿",
  "Bosnia & Herzegovina": "🇧🇦", Sweden: "🇸🇪", "Türkiye": "🇹🇷", Czechia: "🇨🇿", Iraq: "🇮🇶", "DR Congo": "🇨🇩",
};

const PLAYERS = ["Kye", "Blake", "Ish", "Daniel"];
const STORAGE_KEY = "wc2026-flat-sweepstake-v1";

// Knockout rounds with cumulative bonus (reward the journey)
const ROUNDS = [
  { key: "group", label: "Group stage", bonus: 0 },
  { key: "r32", label: "Round of 32", bonus: 5 },
  { key: "r16", label: "Round of 16", bonus: 10 },
  { key: "qf", label: "Quarter-final", bonus: 15 },
  { key: "sf", label: "Semi-final", bonus: 25 },
  { key: "final", label: "Final (runner-up)", bonus: 35 },
  { key: "champion", label: "Champion 🏆", bonus: 50 },
];
const cumulativeBonus = (roundKey) => {
  let total = 0;
  for (const r of ROUNDS) { total += r.bonus; if (r.key === roundKey) break; }
  return total;
};
const GAME_PTS = { W: 3, D: 1, L: 0 };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const emptyResult = () => ({ games: [null, null, null], round: "group", goals: 0 });

export default function App() {
  const [draw, setDraw] = useState(null);      // { player: {1,2,3,4} }
  const [results, setResults] = useState({});   // { team: {games, round, goals} }
  const [countGoals, setCountGoals] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [spin, setSpin] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  // Mirror of current state for the poll loop; when we apply a remote update we set
  // applyingRemote so the save-effect doesn't bounce it straight back to the server;
  // lastEdit defers incoming updates briefly so we don't clobber an in-progress edit.
  const stateRef = useRef({ draw, results, countGoals });
  const applyingRemote = useRef(false);
  const lastEdit = useRef(0);
  useEffect(() => { stateRef.current = { draw, results, countGoals }; });

  const applyState = (s) => {
    if (!s) { setDraw(null); setResults({}); return; }
    setDraw(s.draw ?? null);
    setResults(s.results ?? {});
    if (typeof s.countGoals === "boolean") setCountGoals(s.countGoals);
  };

  // Load shared state from the backend
  useEffect(() => {
    (async () => {
      try { applyState(await loadState()); }
      catch (e) { /* backend unavailable — start fresh, in-memory only */ }
      setLoaded(true);
    })();
  }, []);

  // Persist on change (skip the echo when the change came from a remote update)
  useEffect(() => {
    if (!loaded) return;
    if (applyingRemote.current) { applyingRemote.current = false; return; }
    lastEdit.current = Date.now();
    saveState({ draw, results, countGoals }).catch(() => { /* in-memory only */ });
  }, [draw, results, countGoals, loaded]);

  // Pull in teammates' changes
  useEffect(() => {
    if (!loaded) return;
    return pollState((remote) => {
      // Hold off while the user is actively editing, to avoid clobbering input
      if (Date.now() - lastEdit.current < 2500) return false;
      const cur = stateRef.current;
      const same = JSON.stringify(remote) ===
        JSON.stringify({ draw: cur.draw, results: cur.results, countGoals: cur.countGoals });
      if (same) return true; // nothing new to apply, just acknowledge the version
      applyingRemote.current = true;
      applyState(remote);
      return true;
    });
  }, [loaded]);

  const runDraw = () => {
    setDrawing(true);
    // brief suspense: flash random names, then settle
    let ticks = 0;
    const iv = setInterval(() => {
      const flash = {};
      PLAYERS.forEach((p) => {
        flash[p] = { 1: pick(1), 2: pick(2), 3: pick(3), 4: pick(4) };
      });
      setSpin(flash);
      ticks++;
      if (ticks > 11) {
        clearInterval(iv);
        const newDraw = {};
        const newResults = {};
        [1, 2, 3, 4].forEach((pot) => {
          const picked = shuffle(POTS[pot]).slice(0, PLAYERS.length);
          PLAYERS.forEach((p, i) => {
            newDraw[p] = newDraw[p] || {};
            newDraw[p][pot] = picked[i];
            newResults[picked[i]] = emptyResult();
          });
        });
        setDraw(newDraw);
        setResults(newResults);
        setSpin(null);
        setDrawing(false);
      }
    }, 70);
  };
  const pick = (pot) => POTS[pot][Math.floor(Math.random() * POTS[pot].length)];

  // Pull the latest live results now (also runs automatically every 10 min on the server)
  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const r = await res.json();
      if (r.ok && r.skipped) setSyncMsg("Run the draw first");
      else if (r.ok) {
        applyingRemote.current = true;            // adopt server state without echoing it back
        applyState(await loadState());
        setSyncMsg(`Updated — ${r.finishedGames} games played so far`);
      } else setSyncMsg("Sync failed — try again");
    } catch { setSyncMsg("Sync failed — check your connection"); }
    setSyncing(false);
  };

  const setGame = (team, idx, val) => {
    setResults((prev) => {
      const t = prev[team] || emptyResult();
      const games = [...t.games];
      games[idx] = games[idx] === val ? null : val;
      return { ...prev, [team]: { ...t, games } };
    });
  };
  const setRound = (team, round) => setResults((prev) => ({ ...prev, [team]: { ...(prev[team] || emptyResult()), round } }));
  const setGoals = (team, goals) => setResults((prev) => ({ ...prev, [team]: { ...(prev[team] || emptyResult()), goals: Math.max(0, parseInt(goals || 0, 10)) } }));

  const teamPoints = (team) => {
    const r = results[team] || emptyResult();
    const group = r.games.reduce((s, g) => s + (g ? GAME_PTS[g] : 0), 0);
    const ko = cumulativeBonus(r.round);
    const goalPts = countGoals ? r.goals : 0;
    return { group, ko, goalPts, goals: r.goals, total: group + ko + goalPts };
  };

  const standings = useMemo(() => {
    if (!draw) return [];
    return PLAYERS.map((p) => {
      const teams = [1, 2, 3, 4].map((pot) => draw[p][pot]);
      let total = 0, goals = 0;
      teams.forEach((t) => { const tp = teamPoints(t); total += tp.total; goals += tp.goals; });
      return { player: p, teams, total, goals };
    }).sort((a, b) => b.total - a.total || b.goals - a.goals);
  }, [draw, results, countGoals]);

  if (!loaded) return <div style={{ minHeight: "100vh", background: "#0b0f0d" }} />;

  return (
    <div className="wc-root">
      <style>{css}</style>

      <header className="wc-header">
        <div className="wc-kicker">USA · CANADA · MEXICO &nbsp;//&nbsp; 11 JUN – 19 JUL 2026</div>
        <h1 className="wc-title">FLAT WORLD CUP<span className="wc-title-accent"> SWEEPSTAKE</span></h1>
        <p className="wc-sub">Four flatmates. Four teams each — one from every pot. Best squad takes the prize.</p>
      </header>

      {!draw && (
        <section className="wc-card wc-predraw">
          <div className="wc-pots-grid">
            {[1, 2, 3, 4].map((pot) => (
              <div className="wc-pot" key={pot}>
                <div className="wc-pot-head">POT {pot}</div>
                <ul>
                  {POTS[pot].map((t) => (
                    <li key={t}><span className="wc-flag">{FLAGS[t]}</span>{t}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <button className="wc-draw-btn" onClick={runDraw} disabled={drawing}>
            <Shuffle size={20} /> {drawing ? "DRAWING…" : "RUN THE DRAW"}
          </button>
          {drawing && spin && <SpinPreview spin={spin} />}
        </section>
      )}

      {draw && (
        <>
          {/* Leaderboard */}
          <section className="wc-card">
            <div className="wc-section-head"><Trophy size={18} /> LEADERBOARD</div>
            <div className="wc-board">
              {standings.map((row, i) => (
                <div className={`wc-board-row ${i === 0 && row.total > 0 ? "leader" : ""}`} key={row.player}>
                  <div className="wc-rank">{i + 1}</div>
                  <div className="wc-board-name">{row.player}</div>
                  <div className="wc-board-teams">
                    {row.teams.map((t) => <span key={t} title={t} className="wc-mini-flag">{FLAGS[t]}</span>)}
                  </div>
                  <div className="wc-board-pts">{row.total}<span>pts</span></div>
                </div>
              ))}
            </div>
          </section>

          {/* Tracker */}
          <section className="wc-card">
            <div className="wc-section-head" style={{ justifyContent: "space-between" }}>
              <span><ChevronRight size={18} /> RECORD RESULTS</span>
              <label className="wc-toggle">
                <input type="checkbox" checked={countGoals} onChange={(e) => setCountGoals(e.target.checked)} />
                <Goal size={14} /> count goals (+1 each)
              </label>
            </div>

            {PLAYERS.map((p) => {
              const row = standings.find((s) => s.player === p);
              return (
                <div className="wc-player-block" key={p}>
                  <div className="wc-player-head">
                    <span className="wc-player-name">{p}</span>
                    <span className="wc-player-total">{row ? row.total : 0} pts</span>
                  </div>
                  {[1, 2, 3, 4].map((pot) => {
                    const team = draw[p][pot];
                    const tp = teamPoints(team);
                    const r = results[team] || emptyResult();
                    return (
                      <div className="wc-team-row" key={team}>
                        <div className="wc-team-id">
                          <span className="wc-pot-tag">P{pot}</span>
                          <span className="wc-flag">{FLAGS[team]}</span>
                          <span className="wc-team-name">{team}</span>
                        </div>
                        <div className="wc-games">
                          {[0, 1, 2].map((g) => (
                            <div className="wc-seg" key={g}>
                              {["W", "D", "L"].map((v) => (
                                <button key={v}
                                  className={`wc-seg-btn ${r.games[g] === v ? "on-" + v : ""}`}
                                  onClick={() => setGame(team, g, v)}>{v}</button>
                              ))}
                            </div>
                          ))}
                        </div>
                        <select className="wc-round" value={r.round} onChange={(e) => setRound(team, e.target.value)}>
                          {ROUNDS.map((rd) => (
                            <option key={rd.key} value={rd.key}>{rd.label}{rd.key !== "group" ? ` (+${cumulativeBonus(rd.key)})` : ""}</option>
                          ))}
                        </select>
                        {countGoals && (
                          <input className="wc-goals" type="number" min="0" value={r.goals}
                            onChange={(e) => setGoals(team, e.target.value)} aria-label="goals" />
                        )}
                        <div className="wc-team-pts">{tp.total}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>

          {/* Scoring + controls */}
          <section className="wc-card wc-legend">
            <div className="wc-section-head">SCORING</div>
            <div className="wc-legend-grid">
              <div><b>Group games</b><span>Win 3 · Draw 1 · Loss 0</span></div>
              <div><b>Reaching a round</b><span>R32 +5 · R16 +10 · QF +15 · SF +25 · Final +35 · Champion +50 (stacks)</span></div>
              <div><b>Goals</b><span>+1 each (optional toggle) · also the tiebreaker</span></div>
            </div>
            <div className="wc-controls">
              <button className="wc-ghost" onClick={syncNow} disabled={syncing}>
                <RefreshCw size={15} className={syncing ? "wc-spin-icon" : ""} /> {syncing ? "Syncing…" : "Sync now"}
              </button>
              <span className="wc-saved"><Lock size={12} /> saves automatically</span>
            </div>
            <div className="wc-sync-note">
              <RefreshCw size={11} /> Live results auto-update every 10 min from worldcup26.ir
              {syncMsg && <span className="wc-sync-msg"> · {syncMsg}</span>}
            </div>
          </section>
        </>
      )}
      <footer className="wc-foot">Group results stack with knockout bonuses — even a team that bombs out keeps earning. Goals break ties.</footer>
    </div>
  );
}

function SpinPreview({ spin }) {
  return (
    <div className="wc-spin">
      {PLAYERS.map((p) => (
        <div className="wc-spin-col" key={p}>
          <div className="wc-spin-name">{p}</div>
          {[1, 2, 3, 4].map((pot) => (
            <div className="wc-spin-cell" key={pot}>{FLAGS[spin[p][pot]]} {spin[p][pot]}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;500;600;700;800&display=swap');
.wc-root{
  --bg:#0a0d0b; --panel:#11161300; --card:#131a16; --line:rgba(214,255,180,0.10);
  --ink:#f3f7ee; --muted:#90a08f; --lime:#c4ff3d; --amber:#ffc24d; --red:#ff6a5c; --blue:#5cc8ff;
  font-family:'Archivo',sans-serif; color:var(--ink);
  background:
    radial-gradient(1100px 500px at 80% -10%, rgba(196,255,61,0.10), transparent 60%),
    radial-gradient(900px 500px at -10% 10%, rgba(92,200,255,0.07), transparent 55%),
    repeating-linear-gradient(180deg, transparent, transparent 78px, rgba(255,255,255,0.012) 78px, rgba(255,255,255,0.012) 156px),
    var(--bg);
  min-height:100vh; padding:28px 18px 60px; max-width:920px; margin:0 auto;
}
.wc-header{ text-align:center; margin-bottom:26px; }
.wc-kicker{ font-size:11px; letter-spacing:.28em; color:var(--lime); font-weight:700; }
.wc-title{ font-family:'Anton',sans-serif; font-size:clamp(38px,9vw,76px); line-height:.92; letter-spacing:.01em; margin:10px 0 8px; text-transform:uppercase; }
.wc-title-accent{ color:var(--lime); }
.wc-sub{ color:var(--muted); font-size:15px; max-width:480px; margin:0 auto; }

.wc-card{ background:var(--card); border:1px solid var(--line); border-radius:18px; padding:20px; margin-bottom:18px; box-shadow:0 24px 60px -30px rgba(0,0,0,.8); }
.wc-section-head{ display:flex; align-items:center; gap:8px; font-family:'Anton',sans-serif; letter-spacing:.06em; font-size:18px; color:var(--ink); margin-bottom:16px; }
.wc-section-head svg{ color:var(--lime); }

.wc-pots-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
@media(max-width:680px){ .wc-pots-grid{ grid-template-columns:repeat(2,1fr); } }
.wc-pot-head{ font-family:'Anton',sans-serif; font-size:14px; letter-spacing:.1em; color:var(--lime); padding-bottom:8px; border-bottom:1px solid var(--line); margin-bottom:8px; }
.wc-pot ul{ list-style:none; padding:0; margin:0; }
.wc-pot li{ font-size:13px; padding:3px 0; color:#d8e2d2; display:flex; gap:7px; align-items:center; }
.wc-flag{ font-size:16px; }

.wc-draw-btn{ width:100%; margin-top:18px; padding:16px; border:none; border-radius:12px; cursor:pointer;
  background:var(--lime); color:#0a0d0b; font-family:'Anton',sans-serif; font-size:20px; letter-spacing:.06em;
  display:flex; align-items:center; justify-content:center; gap:10px; transition:transform .12s ease, box-shadow .2s ease; box-shadow:0 12px 30px -10px rgba(196,255,61,.5); }
.wc-draw-btn:hover:not(:disabled){ transform:translateY(-2px); box-shadow:0 18px 40px -10px rgba(196,255,61,.6); }
.wc-draw-btn:disabled{ opacity:.7; cursor:wait; }

.wc-spin{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:16px; }
.wc-spin-col{ background:rgba(255,255,255,.03); border-radius:10px; padding:8px; text-align:center; }
.wc-spin-name{ font-weight:800; font-size:12px; color:var(--lime); margin-bottom:6px; }
.wc-spin-cell{ font-size:11px; color:var(--muted); padding:2px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.wc-board{ display:flex; flex-direction:column; gap:8px; }
.wc-board-row{ display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:12px; background:rgba(255,255,255,.025); border:1px solid transparent; }
.wc-board-row.leader{ border-color:var(--amber); background:linear-gradient(90deg, rgba(255,194,77,.14), rgba(255,194,77,.03)); }
.wc-rank{ font-family:'Anton',sans-serif; font-size:20px; width:24px; color:var(--muted); }
.wc-board-row.leader .wc-rank{ color:var(--amber); }
.wc-board-name{ font-weight:800; font-size:17px; flex:0 0 auto; min-width:64px; }
.wc-board-teams{ display:flex; gap:5px; flex:1; flex-wrap:wrap; }
.wc-mini-flag{ font-size:18px; }
.wc-board-pts{ font-family:'Anton',sans-serif; font-size:26px; color:var(--lime); }
.wc-board-row.leader .wc-board-pts{ color:var(--amber); }
.wc-board-pts span{ font-family:'Archivo'; font-size:11px; color:var(--muted); margin-left:3px; }

.wc-toggle{ font-family:'Archivo'; font-size:12px; font-weight:600; color:var(--muted); display:flex; align-items:center; gap:5px; cursor:pointer; text-transform:none; letter-spacing:0; }
.wc-toggle input{ accent-color:var(--lime); width:15px; height:15px; }

.wc-player-block{ margin-bottom:14px; }
.wc-player-head{ display:flex; justify-content:space-between; align-items:baseline; padding:6px 4px; border-bottom:1px solid var(--line); margin-bottom:6px; }
.wc-player-name{ font-family:'Anton',sans-serif; font-size:18px; letter-spacing:.04em; }
.wc-player-total{ color:var(--lime); font-weight:800; font-size:14px; }

.wc-team-row{ display:flex; align-items:center; gap:10px; padding:8px 4px; flex-wrap:wrap; }
.wc-team-id{ display:flex; align-items:center; gap:8px; flex:1 1 150px; min-width:140px; }
.wc-pot-tag{ font-size:10px; font-weight:800; color:var(--muted); background:rgba(255,255,255,.06); padding:2px 5px; border-radius:5px; }
.wc-team-name{ font-size:14px; font-weight:600; }
.wc-games{ display:flex; gap:6px; }
.wc-seg{ display:flex; border-radius:7px; overflow:hidden; border:1px solid var(--line); }
.wc-seg-btn{ background:transparent; border:none; color:var(--muted); width:24px; height:28px; cursor:pointer; font-size:12px; font-weight:700; font-family:'Archivo'; transition:background .1s; }
.wc-seg-btn:hover{ background:rgba(255,255,255,.05); }
.wc-seg-btn.on-W{ background:var(--lime); color:#0a0d0b; }
.wc-seg-btn.on-D{ background:var(--blue); color:#0a0d0b; }
.wc-seg-btn.on-L{ background:var(--red); color:#0a0d0b; }
.wc-round{ background:#0e130f; color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:6px 8px; font-size:12px; font-family:'Archivo'; cursor:pointer; }
.wc-goals{ width:46px; background:#0e130f; color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:6px; font-size:13px; text-align:center; font-family:'Archivo'; }
.wc-team-pts{ font-family:'Anton',sans-serif; font-size:18px; color:var(--lime); min-width:34px; text-align:right; margin-left:auto; }

.wc-legend-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:16px; }
@media(max-width:680px){ .wc-legend-grid{ grid-template-columns:1fr; } }
.wc-legend-grid div{ background:rgba(255,255,255,.025); border-radius:10px; padding:11px 13px; }
.wc-legend-grid b{ display:block; font-size:13px; color:var(--lime); margin-bottom:3px; }
.wc-legend-grid span{ font-size:12px; color:var(--muted); line-height:1.4; }
.wc-controls{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.wc-ghost{ background:transparent; border:1px solid var(--line); color:var(--ink); padding:8px 13px; border-radius:9px; cursor:pointer; font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px; font-family:'Archivo'; }
.wc-ghost:hover{ border-color:var(--lime); }
.wc-ghost.danger:hover{ border-color:var(--red); color:var(--red); }
.wc-saved{ margin-left:auto; font-size:11px; color:var(--muted); display:flex; align-items:center; gap:4px; }
.wc-sync-note{ margin-top:12px; font-size:11px; color:var(--muted); display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
.wc-sync-note svg{ color:var(--lime); }
.wc-sync-msg{ color:var(--lime); }
.wc-spin-icon{ animation:wc-spin 0.9s linear infinite; }
@keyframes wc-spin{ to{ transform:rotate(360deg); } }
.wc-foot{ text-align:center; color:var(--muted); font-size:12px; margin-top:8px; max-width:560px; margin-left:auto; margin-right:auto; }
`;
