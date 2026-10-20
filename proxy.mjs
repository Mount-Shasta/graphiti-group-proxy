import http from 'node:http';

const UPSTREAM = (process.env.GRAPHITI_URL || 'https://graphiti.h0p.cc').replace(/\/$/, '');
const PORT = parseInt(process.env.PORT || '8000', 10);
const LOG = process.env.LOG !== '0'; // logging on by default, LOG=0 to disable

// Tools that take group_id (singular, string)
const GROUP_ID_TOOLS = new Set([
  'add_memory', 'delete_entity_edge', 'delete_episode',
  'get_entity_edge', 'summarize_saga', 'add_triplet',
  'get_episode_entities',
]);

// Tools that take group_ids (plural, string | string[])
const GROUP_IDS_TOOLS = new Set([
  'search_nodes', 'search_memory_facts', 'build_communities',
  'clear_graph', 'get_episodes',
]);

// Tools with NO group parameter — pass through untouched
const NO_GROUP_TOOLS = new Set(['get_status']);

// Normalize tool name: Paperclip may send hyphens instead of underscores
function normalizeTool(name) {
  return name ? name.replace(/-/g, '_') : name;
}

// Extract group slug from /mcp/{slug} or /{slug}/mcp
function extractGroup(url) {
  const path = url.split('?')[0];
  let m = path.match(/^\/mcp\/([a-zA-Z0-9_-]+)\/?$/);
  if (m) return m[1];
  m = path.match(/^\/([a-zA-Z0-9_-]+)\/mcp\/?$/);
  if (m) return m[1];
  return null;
}

// Scrub and inject group into tools/call arguments
function injectGroup(body, group) {
  if (body?.method !== 'tools/call') return body;

  const rawTool = body.params?.name;
  if (!rawTool) return body;
  const tool = normalizeTool(rawTool);

  // No group param for this tool
  if (NO_GROUP_TOOLS.has(tool)) return body;

  // Start from current args, scrub ALL group-related params first
  const args = { ...(body.params.arguments || {}) };
  delete args.group_id;
  delete args.group_ids;

  // Inject the correct parameter for this tool
  if (GROUP_ID_TOOLS.has(tool)) {
    args.group_id = group;
  } else if (GROUP_IDS_TOOLS.has(tool)) {
    args.group_ids = group;
  } else {
    // Unknown tool — inject BOTH to be safe (Graphiti ignores extra params)
    args.group_id = group;
    args.group_ids = group;
  }

  if (LOG) {
    const action = GROUP_ID_TOOLS.has(tool) ? 'group_id' :
                   GROUP_IDS_TOOLS.has(tool) ? 'group_ids' : 'both';
    console.log(`[inject] ${rawTool} → ${action}="${group}"`);
  }

  return {
    ...body,
    params: { ...body.params, arguments: args },
  };
}

// Handle both single JSON-RPC objects and batched arrays
function processBody(body, group) {
  if (Array.isArray(body)) {
    return body.map(item => injectGroup(item, group));
  }
  return injectGroup(body, group);
}

async function forward(req, res, group) {
  // Collect request body (POST) or empty (GET/DELETE)
  let rawBody = '';
  if (req.method === 'POST') {
    for await (const chunk of req) rawBody += chunk;
  }

  // Build upstream headers
  const headers = {};
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers['accept']) headers['Accept'] = req.headers['accept'];
  if (req.headers['mcp-session-id']) headers['Mcp-Session-Id'] = req.headers['mcp-session-id'];

  // Process body for POST with group injection
  let upstreamBody = rawBody;
  if (req.method === 'POST' && rawBody && group) {
    try {
      let parsed = JSON.parse(rawBody);
      parsed = processBody(parsed, group);
      upstreamBody = JSON.stringify(parsed);
    } catch {
      // Not valid JSON — forward as-is
    }
  }

  const fetchOpts = { method: req.method, headers };
  if (req.method === 'POST') fetchOpts.body = upstreamBody;

  try {
    const upstream = await fetch(`${UPSTREAM}/mcp`, fetchOpts);

    // Relay status + important headers
    const outHeaders = {};
    for (const h of ['content-type', 'mcp-session-id', 'cache-control']) {
      const v = upstream.headers.get(h);
      if (v) outHeaders[h] = v;
    }
    res.writeHead(upstream.status, outHeaders);

    // Stream body
    if (upstream.body) {
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    res.end();
  } catch (err) {
    console.error(`[proxy] upstream error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'upstream_error', detail: err.message }));
  }
}

const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];

  // Health check
  if (path === '/health' || path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', service: 'graphiti-group-proxy', upstream: UPSTREAM }));
    return;
  }

  // Bare /mcp — pass through without group injection (for direct access / testing)
  if (path === '/mcp' || path === '/mcp/') {
    forward(req, res, null);
    return;
  }

  // /mcp/{group} or /{group}/mcp
  const group = extractGroup(req.url);
  if (group) {
    if (LOG) console.log(`[route] ${req.method} ${req.url} → group="${group}"`);
    forward(req, res, group);
    return;
  }

  // Unknown route
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'not_found',
    usage: 'POST /mcp/{group_id} — group-scoped MCP proxy  |  POST /mcp — direct passthrough  |  GET /health',
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`graphiti-group-proxy listening on :${PORT}`);
  console.log(`upstream: ${UPSTREAM}/mcp`);
  console.log(`routes: /mcp/{group} | /{group}/mcp | /mcp (passthrough) | /health`);
});
