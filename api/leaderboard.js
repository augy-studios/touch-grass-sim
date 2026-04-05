export const config = {
    runtime: 'edge'
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
};

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return new Response(JSON.stringify({ error: 'Leaderboard not configured' }), {
            status: 503, headers: corsHeaders,
        });
    }

    const authHeaders = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    };

    // GET — fetch top 10 unique usernames by highest score
    if (req.method === 'GET') {
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/touch_grass_lb?select=username,score,discoveries,time_seconds,rare_finds,location&order=score.desc&limit=500`,
            { headers: authHeaders }
        );
        if (!res.ok) return new Response(JSON.stringify([]), { status: 200, headers: corsHeaders });
        const rows = await res.json();

        // Deduplicate: keep only the highest-score entry per username
        const best = new Map();
        for (const row of rows) {
            const key = row.username?.toLowerCase() ?? '';
            if (!best.has(key) || row.score > best.get(key).score) {
                best.set(key, row);
            }
        }
        const data = [...best.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=30' },
        });
    }

    // POST — submit a score
    if (req.method === 'POST') {
        let body;
        try { body = await req.json(); } catch {
            return new Response('Bad request', { status: 400 });
        }

        const { username, discoveries, time_seconds, rare_finds, location } = body;
        if (!username || typeof discoveries !== 'number') {
            return new Response('Invalid data', { status: 400 });
        }

        const res = await fetch(`${SUPABASE_URL}/rest/v1/touch_grass_lb`, {
            method: 'POST',
            headers: {
                ...authHeaders,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
                username: String(username).slice(0, 32),
                score: Math.max(0, Math.floor(body.score ?? 0)),
                discoveries: Math.max(0, Math.floor(discoveries)),
                time_seconds: Math.max(0, Math.floor(time_seconds)),
                rare_finds: Math.max(0, Math.floor(rare_finds)),
                location: String(location || '').slice(0, 64),
            }),
        });

        if (!res.ok) {
            const err = await res.text();
            return new Response(JSON.stringify({ error: err }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
    }

    return new Response('Method not allowed', { status: 405 });
}
