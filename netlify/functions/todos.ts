import type { Config, Context } from "@netlify/functions";

const BOARD_KEY = "kenny-life-board";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...cors,
    },
  });
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  // Dynamic import avoids CJS/ESM bundling conflicts with @netlify/blobs
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "life-board", consistency: "strong" });

  if (req.method === "GET") {
    const data = (await store.get(BOARD_KEY, { type: "json" })) as
      | { todos?: unknown; updatedAt?: number }
      | null;
    return json({
      todos: Array.isArray(data?.todos) ? data.todos : [],
      updatedAt: data?.updatedAt ?? 0,
    });
  }

  if (req.method === "PUT") {
    let body: { todos?: unknown; updatedAt?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (!Array.isArray(body.todos)) {
      return json({ error: "todos must be an array" }, 400);
    }

    const existing = (await store.get(BOARD_KEY, { type: "json" })) as
      | { todos?: unknown; updatedAt?: number }
      | null;
    const incomingUpdatedAt = Number(body.updatedAt) || Date.now();
    const existingUpdatedAt = Number(existing?.updatedAt) || 0;

    if (existing && existingUpdatedAt > incomingUpdatedAt) {
      return json({
        todos: existing.todos,
        updatedAt: existingUpdatedAt,
        conflict: true,
      });
    }

    const payload = {
      todos: body.todos,
      updatedAt: incomingUpdatedAt,
    };
    await store.setJSON(BOARD_KEY, payload);
    return json(payload);
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config: Config = {
  path: "/api/todos",
  method: ["GET", "PUT", "OPTIONS"],
};
