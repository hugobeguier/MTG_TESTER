# XMage Bridge

The web app treats XMage as the rules authority. The current implementation exposes a clean boundary through `XMAGE_BRIDGE_URL`; the next implementation step is a small local bridge process that talks to an installed XMage server and exposes HTTP endpoints.

Expected bridge endpoints:

- `GET /health`
- `POST /matches/commander`
- `GET /matches/:id/state`
- `POST /matches/:id/actions`

The app must never apply an agent action directly to game state. It should send the proposed action to the bridge, let XMage validate/execute it, then render the resulting XMage event stream.

Environment:

```text
XMAGE_BRIDGE_URL=http://localhost:8088
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```
