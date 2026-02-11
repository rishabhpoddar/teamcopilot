# Dashboard Implementation Plan

## Overview
After sign up/sign in, show a main dashboard with 3 sections:
1. **Available Workflows** - List of workflows available to run (from filesystem). Each workflow card shows who created and approved the workflow.
2. **Workflow Run History** - History of all workflow runs across all users
3. **AI Mode** - Chat interface for running/creating workflows. Shows a list of the user's previous AI chat sessions for easy access to chat history.

## Implementation

### 1. Database Schema
Add `workflow_runs`, `workflows`, and `ai_chat_sessions` tables to `prisma/schema.prisma`:

```prisma
model workflow_runs {
  id             String  @id @default(uuid())
  ran_by_user_id String
  status         String // "running" | "success" | "failed"
  started_at     BigInt
  completed_at   BigInt?
  args           String? // JSON string of input arguments passed to the workflow
  error_message  String?
  workflow_slug  String
  user           users   @relation(fields: [ran_by_user_id], references: [id], onDelete: Cascade)

  @@index([started_at])
}

model ai_chat_sessions {
  id          String  @id @default(uuid())
  user_id     String
  title       String?
  created_at  BigInt
  updated_at  BigInt
  messages    String  // JSON string of chat messages

  user users @relation(fields: [user_id], references: [id])

  @@index([user_id, updated_at])
}
```



### 2. Backend API Endpoints

**Create `/src/workflows/index.ts` with:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workflows` | GET | List workflows from DB (includes creator & approver info) |
| `/api/workflows` | POST | Create a new workflow (Engineers only) |
| `/api/workflows/:slug/approve` | POST | Approve a workflow (Engineers only) |
| `/api/workflows/runs` | GET | List workflow run history (last 50, all users) |
| `/api/workflows/runs` | POST | Create new workflow run record |
| `/api/workflows/runs/:id` | PATCH | Update run status (complete/failed) |

**Create `/src/ai-chat/index.ts` with:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai-chat/sessions` | GET | List user's chat sessions (most recent first) |
| `/api/ai-chat/sessions` | POST | Create a new chat session |
| `/api/ai-chat/sessions/:id` | GET | Get a specific chat session with messages |
| `/api/ai-chat/sessions/:id` | PATCH | Update chat session (add messages, update title) |
| `/api/ai-chat/sessions/:id` | DELETE | Delete a chat session |

Register in `src/index.ts`:
- `apiRouter.use('/workflows', workflowsRouter);`
- `apiRouter.use('/ai-chat', aiChatRouter);`

### 3. Frontend Components

**Files to create:**
```
frontend/src/components/dashboard/
├── WorkflowsSection.tsx    # Lists available workflows as cards
├── RunHistorySection.tsx   # Shows run history table
├── AIModeSection.tsx       # Chat interface with session history sidebar
├── WorkflowCard.tsx        # Individual workflow card (shows creator & approver)
└── ChatSessionList.tsx     # List of user's AI chat sessions
```

**WorkflowCard Features:**
- Display workflow name, description, version
- Show "Created by: [user name]"
- Show "Approved by: [user name]" (or "Pending approval" if not approved)

**AIModeSection Features:**
- Left sidebar showing list of user's previous chat sessions
- Click on a session to load that conversation
- "New Chat" button to start a fresh session
- Main chat area for current conversation

**Update `frontend/src/pages/Home.tsx`:**
- Add tab navigation (Workflows | Run History | AI Mode)
- Render appropriate section based on active tab
- Use `axiosInstance` from utils.ts for API calls

### 4. Dependencies
Install in frontend/:
```bash
npm install react-toastify
```
Add ToastContainer to `main.tsx` for non-GET error notifications.

### 5. Styling
Add dashboard styles to `frontend/src/App.css`:
- Tab navigation styling
- Workflow card grid layout
- Run history table styling
- Chat interface styling
- Light/dark mode support

## Files to Modify/Create

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Add workflows, workflow_runs, ai_chat_sessions tables |
| `src/workflows/index.ts` | Create - Workflows API routes |
| `src/ai-chat/index.ts` | Create - AI Chat sessions API routes |
| `src/index.ts` | Register workflows and ai-chat routers |
| `frontend/src/pages/Home.tsx` | Rewrite - tabbed dashboard |
| `frontend/src/components/dashboard/*.tsx` | Create - 5 components |
| `frontend/src/App.css` | Add dashboard styles |
| `frontend/src/main.tsx` | Add ToastContainer |
| `frontend/package.json` | Add react-toastify |

## Verification
1. Run `npx prisma migrate dev` - verify migration succeeds
2. Start backend: `npm run dev` (from root)
3. Start frontend: `npm run dev` (from frontend/)
4. Sign in and verify dashboard loads
5. Check that Workflows tab shows empty state or workflows if directory exists
6. Check that Run History tab shows empty state
7. Check that AI Mode tab shows chat placeholder
8. Verify tab switching works correctly