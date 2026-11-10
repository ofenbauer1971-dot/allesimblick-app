import webpush from "web-push";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 120;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}
function response(request, env, data, status = 200) {
  const cors = corsHeaders(request, env);
  if (request.headers.get("Origin") && !cors["access-control-allow-origin"]) {
    return json({ error: "Origin nicht erlaubt." }, 403);
  }
  return json(data, status, cors);
}
async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}
async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function bearer(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
async function authenticatedDevice(request, env) {
  const token = bearer(request);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  return sha256(token);
}
function validSubscription(s) {
  return s && typeof s.endpoint === "string" && s.endpoint.startsWith("https://") &&
    s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
}
function validReminder(r) {
  const at = Date.parse(r?.scheduledAt);
  return r && typeof r.id === "string" && r.id.length <= 100 &&
    Number.isFinite(at) && at > Date.now() && at < Date.now() + MAX_FUTURE_MS &&
    typeof r.title === "string" && r.title.trim().length > 0 && r.title.length <= MAX_TEXT &&
    typeof r.body === "string" && r.body.length <= 240;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      const cors = corsHeaders(request, env);
      if (!cors["access-control-allow-origin"]) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      return response(request, env, { ok: true, service: "AllesImBlick Push" });
    }
    if (url.pathname === "/api/config" && request.method === "GET") {
      if (!env.VAPID_PUBLIC_KEY) return response(request, env, { error: "Push-Dienst ist noch nicht konfiguriert." }, 503);
      return response(request, env, { publicKey: env.VAPID_PUBLIC_KEY });
    }

    const deviceHash = await authenticatedDevice(request, env);
    if (!deviceHash) return response(request, env, { error: "Geräteberechtigung fehlt." }, 401);

    if (url.pathname === "/api/register" && request.method === "POST") {
      const data = await readJson(request);
      if (!validSubscription(data?.subscription)) return response(request, env, { error: "Ungültiges Push-Abonnement." }, 400);
      const endpointHash = await sha256(data.subscription.endpoint);
      await env.DB.prepare(
        "INSERT INTO subscriptions (device_hash, endpoint_hash, subscription_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(device_hash, endpoint_hash) DO UPDATE SET subscription_json=excluded.subscription_json, updated_at=excluded.updated_at"
      ).bind(deviceHash, endpointHash, JSON.stringify(data.subscription), Date.now()).run();
      return response(request, env, { ok: true });
    }

    if (url.pathname === "/api/reminders" && request.method === "PUT") {
      const data = await readJson(request);
      if (!validReminder(data)) return response(request, env, { error: "Erinnerung ungültig oder Datum außerhalb des erlaubten Zeitraums." }, 400);
      await env.DB.prepare(
        "INSERT INTO reminders (device_hash, reminder_id, scheduled_at, title, body, target_url, status, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?) ON CONFLICT(device_hash, reminder_id) DO UPDATE SET scheduled_at=excluded.scheduled_at, title=excluded.title, body=excluded.body, target_url=excluded.target_url, status='pending', attempts=0"
      ).bind(deviceHash, data.id, Date.parse(data.scheduledAt), data.title.trim(), data.body, "./", Date.now()).run();
      return response(request, env, { ok: true });
    }

    if (url.pathname.startsWith("/api/reminders/") && request.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.slice("/api/reminders/".length));
      if (!id || id.length > 100) return response(request, env, { error: "Ungültige Erinnerungs-ID." }, 400);
      await env.DB.prepare("DELETE FROM reminders WHERE device_hash = ? AND reminder_id = ?").bind(deviceHash, id).run();
      return response(request, env, { ok: true });
    }

    if (url.pathname === "/api/unregister" && request.method === "POST") {
      await env.DB.prepare("DELETE FROM reminders WHERE device_hash = ?").bind(deviceHash).run();
      await env.DB.prepare("DELETE FROM subscriptions WHERE device_hash = ?").bind(deviceHash).run();
      return response(request, env, { ok: true });
    }
    return response(request, env, { error: "Nicht gefunden." }, 404);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(deliverDueReminders(env));
  }
};

async function deliverDueReminders(env) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const now = Date.now();
  const due = await env.DB.prepare(
    "SELECT r.device_hash, r.reminder_id, r.title, r.body, r.target_url, s.subscription_json, s.endpoint_hash FROM reminders r JOIN subscriptions s ON s.device_hash = r.device_hash WHERE r.status = 'pending' AND r.scheduled_at <= ? ORDER BY r.scheduled_at LIMIT 100"
  ).bind(now).all();

  for (const row of due.results || []) {
    const lock = await env.DB.prepare(
      "UPDATE reminders SET status='sending', attempts=attempts+1 WHERE device_hash=? AND reminder_id=? AND status='pending'"
    ).bind(row.device_hash, row.reminder_id).run();
    if (!lock.meta?.changes) continue;
    try {
      await webpush.sendNotification(JSON.parse(row.subscription_json), JSON.stringify({
        title: row.title,
        body: row.body,
        url: row.target_url || "./",
        tag: "aib-" + row.reminder_id
      }), { TTL: 86400, urgency: "normal" });
      await env.DB.prepare("UPDATE reminders SET status='sent', sent_at=? WHERE device_hash=? AND reminder_id=?")
        .bind(Date.now(), row.device_hash, row.reminder_id).run();
    } catch (error) {
      const status = Number(error?.statusCode || 0);
      if (status === 404 || status === 410) {
        await env.DB.prepare("DELETE FROM subscriptions WHERE device_hash=? AND endpoint_hash=?")
          .bind(row.device_hash, row.endpoint_hash).run();
        await env.DB.prepare("DELETE FROM reminders WHERE device_hash=? AND reminder_id=?")
          .bind(row.device_hash, row.reminder_id).run();
      } else {
        const delay = status >= 500 || status === 429 ? 60_000 : 5 * 60_000;
        await env.DB.prepare("UPDATE reminders SET status='pending', scheduled_at=?, last_error=? WHERE device_hash=? AND reminder_id=?")
          .bind(Date.now() + delay, String(error?.message || "Push-Versand fehlgeschlagen").slice(0, 200), row.device_hash, row.reminder_id).run();
      }
    }
  }

  await env.DB.prepare("DELETE FROM reminders WHERE status='sent' AND sent_at < ?")
    .bind(now - 30 * 24 * 60 * 60 * 1000).run();
}
