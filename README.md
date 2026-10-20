# graphiti-group-proxy

Thin MCP proxy that injects `group_id` into Graphiti tool calls based on URL path. Enables per-organization memory segmentation when connecting multiple Paperclip orgs to a single Graphiti instance.

## How it works

```
Paperclip (ProTechGuard)  ──POST /mcp/protechguard──►  Proxy  ──POST /mcp──►  Graphiti
                                                        (injects group_id=protechguard)
```

1. Accepts MCP connections at `/mcp/{group_slug}` (or `/{group_slug}/mcp`)
2. For `tools/call` requests, injects `group_id` or `group_ids` into the arguments
3. Forwards everything to the upstream Graphiti MCP server
4. Passes through `Mcp-Session-Id` headers and SSE responses

### Graphiti parameter mapping

| Parameter | Tools |
|-----------|-------|
| `group_id` (singular) | add_memory, delete_entity_edge, delete_episode, get_entity_edge, summarize_saga, add_triplet, get_episode_entities |
| `group_ids` (plural) | search_nodes, search_memory_facts, build_communities, clear_graph, get_episodes |
| (none) | get_status — passes through unchanged |

## Routes

| Route | Description |
|-------|-------------|
| `POST /mcp/{group}` | Group-scoped MCP proxy |
| `POST /{group}/mcp` | Alternate path format |
| `POST /mcp` | Direct passthrough (no group injection) |
| `GET /health` | Health check |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `GRAPHITI_URL` | `https://graphiti.h0p.cc` | Upstream Graphiti server |
| `PORT` | `8000` | Listen port |

## Deploy

```bash
docker build -t graphiti-group-proxy .
docker run -p 8000:8000 -e GRAPHITI_URL=https://graphiti.h0p.cc graphiti-group-proxy
```
