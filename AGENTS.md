# VibeHub integration rules

- Multiplayer must load the absolute Beta SDK URL: `https://vibe.lumigrav.space/sdk/beta/vibehub.js`.
- Use the exact project slug from `VITE_VIBEHUB_WORK` or the hosted `vibeapps` path; never guess a slug or use a work ID.
- Synchronization is `host-authority`: clients send reliable actions, the host validates and advances game state.
- Turn actions and authoritative snapshots use reliable `room.send`; do not add a custom WebSocket/backend/database or poll realtime game state.
- Personal progress and loadouts use `vibe.save`; room metadata/state uses the joined room and `room.data` when persistence is needed.
- Send player-specific redacted snapshots. Never expose another player's UNO cards, Hearth cards, private deck order, or selection state.
- Rooms and matches support 2–8 human players.
