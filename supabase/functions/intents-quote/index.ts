const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const intentsApi = 'https://1click.chaindefuser.com';

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const body = await request.json();
    if (!body?.originAsset || !body?.amount || !body?.recipient) return new Response(JSON.stringify({ error: 'Missing quote fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const response = await fetch(`${intentsApi}/v0/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(Deno.env.get('NEAR_INTENTS_API_KEY') ? { Authorization: `Bearer ${Deno.env.get('NEAR_INTENTS_API_KEY')}` } : {}) },
      body: JSON.stringify({ dry: body.dry !== false, swapType: 'EXACT_INPUT', originAsset: body.originAsset, destinationAsset: body.destinationAsset ?? 'nep141:wrap.near', amount: String(body.amount), recipient: { wallet: body.recipient, chain: 'near' } }),
    });
    const payload = await response.json();
    return new Response(JSON.stringify(payload), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: 'Unable to create an Intents quote' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
