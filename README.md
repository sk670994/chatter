## Chatter

Incremental build of a chat app with tool-calling support.

### PR Plan

1. PR-1: Project cleanup + chat UI/base client flow
2. PR-2: Backend `/chat` LLM integration + model fallback
3. PR-3: Conversation history APIs + frontend history wiring
4. PR-4: Tool-calling framework + `get_weather` free API tool
5. PR-5: Error handling, env/docs, test prompts, polish

### PR-1 Scope (current)

- Replaced scaffold landing page with chat-first UI
- Persisted `conversationId` in `localStorage`
- Wired client send flow to `POST /api/chat`
- Added temporary `/api/chat` route handler stub for local end-to-end flow

### Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
