# graphiti-group-proxy

Authenticated MCP proxy that injects `group_id` into Graphiti tool calls based on URL path. Enables per-organization memory segmentation when connecting multiple Paperclip orgs to a single Graphiti instance.

## How it works

```
Paperclip (ProTechGuard)  ──POST /mcp/protechguard──►  Proxy  ──POST /mcp──►  Graphiti
                            + Bearer token               (injects group_id=protechguard)
```

1. Validates bearer token (`AUTH_TOKEN` env var) — rejects unauthenticated requests
2. Accepts MCP connections at `/mcp/{group_slug}` (or `/{group_slug}/mcp`)
3. Scrubs any user-supplied `group_id`/`group_ids` from tool call arguments
4. Injects the correct group parameter based on the URL path
5. Normalizes tool names (hyphens → underscores) for Paperclip compatibility
6. Forwards to the upstream Graphiti MCP server

### Security model

- **Authentication**: All routes except `/health` require `Authorization: Bearer <token>`
- **Group isolation**: Clients can only access data in the group specified by their URL path
- **Read protection**: User-supplied `group_id`/`group_ids` are scrubbed before injection — spoofing is impossible
- **No passthrough**: Bare `/mcp` is disabled — every request must be group-scoped
- **Fail closed**: If `AUTH_TOKEN` is not set, all requests are rejected

### Graphiti parameter mapping

| Parameter | Tools |
|-----------|-------|
| `group_id` (singular) | add_memory, delete_entity_edge, delete_episode, get_entity_edge, summarize_saga, add_triplet, get_episode_entities |
| `group_ids` (plural, array) | search_nodes, search_memory_facts, build_communities, clear_graph, get_episodes |
| (none) | get_status — passes through unchanged |

## Routes

| Route | Auth | Description |
|-------|------|-------------|
| `POST /mcp/{group}` | ✅ Bearer | Group-scoped MCP proxy |
| `POST /{group}/mcp` | ✅ Bearer | Alternate path format |
| `GET /health` | ❌ None | Health check (for load balancers) |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `AUTH_TOKEN` | *(required)* | Bearer token for authentication. If unset, all requests are rejected. |
| `GRAPHITI_URL` | `https://graphiti.h0p.cc` | Upstream Graphiti server |
| `PORT` | `8000` | Listen port |
| `LOG` | `1` | Set to `0` to disable request logging |

## Deploy

```bash
docker build -t graphiti-group-proxy .
docker run -p 8000:8000 \
  -e AUTH_TOKEN=your-secret-token \
  -e GRAPHITI_URL=http://graphiti-internal:8000 \
  graphiti-group-proxy
```

## Connecting from Paperclip

In your Paperclip org's MCP connector settings, set:
- **URL**: `https://graphiti-gw.h0p.cc/mcp/your-org-slug`
- **Headers**: `Authorization: Bearer <your-auth-token>`
