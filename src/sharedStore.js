// Client for the shared sweepstake state served by the Netlify Function at /api/state.
// Versioning is server-stamped (Date.now); we track the last version we've seen so
// polling only surfaces *other people's* changes, never echoes our own writes back.
const API = "/api/state";
let lastVersion = 0;

// Load the shared state. Returns the saved object, or null if nothing saved yet.
export async function loadState() {
  const res = await fetch(API);
  if (!res.ok) return null;
  const data = await res.json(); // { value, version } | null
  if (!data) return null;
  lastVersion = data.version || 0;
  return data.value ? JSON.parse(data.value) : null;
}

// Save the shared state. Advances our lastVersion so our own write won't re-trigger.
export async function saveState(state) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: JSON.stringify(state) }),
  });
  if (!res.ok) return;
  const data = await res.json();
  if (data && data.version) lastVersion = data.version;
}

// Poll for changes made by others. onRemote(state) is called only when the server
// has a newer version than we've seen. If onRemote returns false, the version is NOT
// advanced (so we'll retry next tick) — used to defer while the user is mid-edit.
export function pollState(onRemote, intervalMs = 3000) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const res = await fetch(API);
      if (!res.ok) return;
      const data = await res.json();
      if (data && (data.version || 0) > lastVersion) {
        const applied = onRemote(data.value ? JSON.parse(data.value) : null);
        if (applied !== false) lastVersion = data.version;
      }
    } catch { /* network blip — try again next tick */ }
  };
  const id = setInterval(tick, intervalMs);
  return () => { stopped = true; clearInterval(id); };
}
