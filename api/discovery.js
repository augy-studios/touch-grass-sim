export const config = {
    runtime: 'edge'
};

const LOCATION_POOLS = {
    botanic: {
        common: ['a fallen orchid petal', 'a plant label stake', 'a tour map scrap', 'a seed pod'],
        uncommon: ['a heritage-tree plaque shard', 'a rare orchid tag', 'a guided walk sticker'],
        rare: ['a Raffles-era trade bead', 'a colonial botanical coin', 'a 1960s Singapore Garden Festival pin']
    },
    eastcoast: {
        common: ['a bottle cap', 'a kite string spool', 'a satay stick', 'a BBQ skewer'],
        uncommon: ['a beach volleyball net clip', 'a lost flip-flop buckle', 'a cycling race number'],
        rare: ['a 1970s kampung fishing weight', 'a WWII-era button', 'a Malay silver ring']
    },
    macritchie: {
        common: ['a fallen tembusu leaf', 'a monkey paw print in mud', 'a trail marker chip'],
        uncommon: ['a birdwatcher\'s log page', 'a treetop walk wristband', 'a park ranger badge'],
        rare: ['a fossilised seed', 'a Orang Asli flint chip', 'a colonial survey marker']
    },
    gardensbay: {
        common: ['a dropped lanyard clip', 'a tourist map fragment', 'a night-show wristband'],
        uncommon: ['a Supertree planting tag', 'a conservatory seed label', 'a media pass clip'],
        rare: ['a Marina Bay Sands opening coin', 'a 2010 F1 grandstand ticket stub']
    },
    reservoir: {
        common: ['a fishing line float', 'a kayak paddle clip', 'a dragonfly wing'],
        uncommon: ['a rowing club badge', 'a reservoir pass card', 'a monitor lizard shed skin'],
        rare: ['a 1950s Public Utilities Board token', 'a colonial water survey peg']
    },
    padang: {
        common: ['a cricket ball seam scrap', 'a grass-stained rugby stud', 'a flag base pin'],
        uncommon: ['a National Day Parade seat tag', 'a colonial cricket club badge'],
        rare: ['a 1965 Independence ceremony token', 'a Raffles Institution sporting medal']
    },
    railcorridor: {
        common: ['a rusted rail spike', 'a broken ceramic tile shard', 'a kampung nail'],
        uncommon: ['a KTM train ticket stub', 'a colonial milepost shard'],
        rare: ['a 1932 Malayan Railway button', 'an Orang Seletar trade bead']
    },
    punggol: {
        common: ['a kelong rope fibre', 'a mangrove propagule', 'a canal marker chip'],
        uncommon: ['a kayak club sticker', 'a waterway cleanup badge', 'a heron feather'],
        rare: ['an old kampung door hinge', 'a 1980s HDB construction token']
    },
    default: {
        common: ['a void-deck chair leg tip', 'a kopi cup lid', 'an ang pow packet corner', 'a 4D slip fragment'],
        uncommon: ['a lost EZ-Link card', 'a hawker centre queue number', 'a school CCA badge'],
        rare: ['a 1960s Singapore coin', 'a colonial postal stamp fragment', 'a Peranakan tile shard']
    },
};

const TIME_CONTEXT = {
    dawn: {
        feel: 'quiet and dewy',
        extra: 'Dew drops glisten; spider webs are visible; early joggers have passed.'
    },
    morning: {
        feel: 'fresh and busy',
        extra: 'Commuters and dog walkers have been through; coffee cups may have been dropped.'
    },
    day: {
        feel: 'bright and active',
        extra: 'Picnickers, children, and workers take lunch breaks here.'
    },
    dusk: {
        feel: 'golden and winding-down',
        extra: 'Evening walkers and cyclists; vendors packing up; long shadows everywhere.'
    },
    evening: {
        feel: 'warm and social',
        extra: 'Evening gatherings; food smells; festival lights; couples strolling.'
    },
    night: {
        feel: 'mysterious and still',
        extra: 'Only the nocturnal visit; moonlight; the city is quiet; dew is forming again.'
    },
};

function locationPool(loc = '') {
    const l = loc.toLowerCase();
    if (l.includes('botanic')) return LOCATION_POOLS.botanic;
    if (l.includes('east coast')) return LOCATION_POOLS.eastcoast;
    if (l.includes('macritchie') || l.includes('reservoir')) return LOCATION_POOLS.reservoir;
    if (l.includes('gardens by the bay')) return LOCATION_POOLS.gardensbay;
    if (l.includes('rail corridor')) return LOCATION_POOLS.railcorridor;
    if (l.includes('padang') || l.includes('kallang')) return LOCATION_POOLS.padang;
    if (l.includes('punggol') || l.includes('sengkang')) return LOCATION_POOLS.punggol;
    if (l.includes('park') || l.includes('garden')) return LOCATION_POOLS.default;
    return LOCATION_POOLS.default;
}

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method not allowed', {
        status: 405
    });

    let body;
    try {
        body = await req.json();
    } catch {
        return new Response('Bad request', {
            status: 400
        });
    }

    const {
        location = '', timeOfDay = 'day', rarity = 0.5, recent = []
    } = body;
    const pool = locationPool(location);
    const tCtx = TIME_CONTEXT[timeOfDay] || TIME_CONTEXT.day;
    const loc = location ? `in ${location}` : 'in grass';

    let tier, rarityLabel, examples;
    if (rarity < 0.70) {
        tier = 'common';
        rarityLabel = 'common';
        examples = pool.common;
    } else if (rarity < 0.90) {
        tier = 'uncommon';
        rarityLabel = 'uncommon';
        examples = pool.uncommon;
    } else {
        tier = 'rare';
        rarityLabel = 'rare';
        examples = pool.rare;
    }

    const exStr = examples.join(', ');
    const recStr = recent.length ? `Avoid repeating these recent finds: ${recent.join(', ')}.` : '';

    const prompt = `You generate names of small objects found ${loc} during ${timeOfDay} (${tCtx.feel}).
Context: ${tCtx.extra}
Rarity tier: ${tier}. Examples for this tier at this location: ${exStr}.
${recStr}

Rules:
- Respond with ONLY the object name, 2–6 words, lowercase, starting with "a" or "an".
- Be specific and evocative but realistic for the location and time.
- Do NOT add commentary, quotes, or punctuation outside the object name.
- For "rare": make it genuinely surprising – historical, natural wonder, or deeply sentimental.`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({
        error: 'API key not configured'
    }), {
        status: 500
    });

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 40,
            messages: [{
                role: 'user',
                content: prompt
            }],
        }),
    });

    if (!apiRes.ok) {
        const err = await apiRes.text();
        return new Response(JSON.stringify({
            error: err
        }), {
            status: 500
        });
    }

    const data = await apiRes.json();
    const raw = data.content ?. [0] ?.text ?.trim() ?? '';
    // sanitise – strip quotes, limit length
    const text = raw.replace(/["']/g, '').slice(0, 64).toLowerCase();

    return new Response(JSON.stringify({
        text,
        rarityLabel
    }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
        },
    });
}