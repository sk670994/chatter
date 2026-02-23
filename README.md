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

### PR-2 Scope (current)

- Replaced `/api/chat` stub with real Gemini API integration
- Added model fallback logic (`GEMINI_MODELS`, comma-separated)
- Added in-memory conversation context for multi-turn `/api/chat` requests

### Environment

Create `.env.local`:

```bash
GEMINI_API_KEY=your_api_key_here
GEMINI_MODELS=gemini-2.0-flash,gemini-1.5-flash
```

### PR-3 Scope (current)

- Added `GET /api/history/:conversationId` to restore conversation history
- Added `DELETE /api/history/:conversationId` to clear conversation history
- Wired frontend to auto-load history for saved `conversationId`
- Wired "New Chat" to clear old history before starting a new conversation
- Added auto-scroll to latest message for long replies

### PR-4 Scope (current)

- Added tool-calling orchestration loop in Gemini backend wrapper
- Added tool registry and declaration plumbing
- Implemented free/open tools: `get_weather`, `currency_convert`, `geocode_location`, `air_quality`, `time_in_location`
- Added loop/time safeguards (`TOOL_LOOP_LIMIT`, tool timeout)
- Persisted full conversation turns including function call/response parts

### Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
