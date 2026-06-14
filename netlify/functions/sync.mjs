import { runSync } from "../lib/syncCore.mjs";

// Manual trigger: POST /api/sync (used by the "Sync now" button and for testing).
export default async () => {
  try {
    const result = await runSync();
    return Response.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
};
