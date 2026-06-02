import { getStore } from "@netlify/blobs";

// Shared sweepstake state, stored as a single record in a Netlify Blobs store.
// GET  /api/state        -> { value, version } | null
// POST /api/state {value} -> { version }   (version is a server timestamp)
export default async (req) => {
  const store = getStore("sweepstake");

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }
    const version = Date.now();
    await store.setJSON("state", { value: body.value ?? null, version });
    return Response.json({ version });
  }

  if (req.method === "GET") {
    const data = await store.get("state", { type: "json" });
    return Response.json(data ?? null);
  }

  return new Response("Method not allowed", { status: 405 });
};
