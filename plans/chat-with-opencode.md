 Chat with Opencode Server - Implementation Plan                                                                                 
                                                                                                                                 
 Overview                                                                                                                        
                                                                                                                                 
 Add a chat interface to LocalTool that communicates with the opencode server running on port 4096. The backend proxies all      
 requests (frontend never contacts opencode directly), and real-time updates are handled via SSE.                                
                                                                                                                                 
 Frontend (React) <--HTTP/SSE--> Backend (Express) <--SDK--> Opencode Server (port 4096)                                         
                                                                                                                                 
 Backend Changes                                                                                                                 
                                                                                                                                 
 1. Create Opencode Client Utility                                                                                               
                                                                                                                                 
 File: src/utils/opencode-client.ts                                                                                              
                                                                                                                                 
 import { createOpencodeClient } from "@opencode-ai/sdk/client";                                                                 
 import path from "path";                                                                                                        
                                                                                                                                 
 export function getOpencodeClient() {                                                                                           
     const port = parseInt(process.env.OPENCODE_PORT || "4096", 10);                                                             
                                                                                                                                 
     // Get workspace directory from env, resolve relative paths to absolute                                                     
     let workspaceDir = process.env.WORKSPACE_DIR || "./my_workspaces";                                                          
     if (!path.isAbsolute(workspaceDir)) {                                                                                       
         workspaceDir = path.resolve(process.cwd(), workspaceDir);                                                               
     }                                                                                                                           
                                                                                                                                 
     return createOpencodeClient({                                                                                               
         baseUrl: `http://localhost:${port}`,                                                                                    
         directory: workspaceDir  // Set workspace directory for opencode operations                                             
     });                                                                                                                         
 }                                                                                                                               
                                                                                                                                 
 2. Database Schema (User-owned sessions)                                                                                        
                                                                                                                                 
 File: prisma/schema.prisma - Add chat_sessions table:                                                                           
                                                                                                                                 
 model chat_sessions {                                                                                                           
   id                  String   @id @default(uuid())                                                                             
   user_id             String                                                                                                    
   opencode_session_id String   @unique                                                                                          
   title               String?                                                                                                   
   created_at          BigInt                                                                                                    
   updated_at          BigInt                                                                                                    
   user                users    @relation(fields: [user_id], references: [id], onDelete: Cascade)                                
 }                                                                                                                               
                                                                                                                                 
 3. Chat Routes                                                                                                                  
                                                                                                                                 
 File: src/chat/index.ts                                                                                                         
 ┌────────┬─────────────────────────────────┬──────────────────────────────────┐                                                 
 │ Method │            Endpoint             │           Description            │                                                 
 ├────────┼─────────────────────────────────┼──────────────────────────────────┤                                                 
 │ GET    │ /api/chat/sessions              │ List user's sessions             │                                                 
 ├────────┼─────────────────────────────────┼──────────────────────────────────┤                                                 
 │ POST   │ /api/chat/sessions              │ Create new session               │                                                 
 ├────────┼─────────────────────────────────┼──────────────────────────────────┤                                                 
 │ GET    │ /api/chat/sessions/:id          │ Get session details              │                                                 
 ├────────┼─────────────────────────────────┼──────────────────────────────────┤                                                 
 │ DELETE │ /api/chat/sessions/:id          │ Delete session                   │                                                 
 ├────────┼─────────────────────────────────┼──────────────────────────────────┤                                                 
 │ GET    │ /api/chat/sessions/:id/messages │ Get messages                     │                                                 
 ├────────┼─────────────────────────────────┼──────────────────────────────────┤                                                 
 │ POST   │ /api/chat/sessions/:id/messages │ Send message                     │                                                 
 ├────────┼─────────────────────────────────┼──────────────────────────────────┤                                                 
 │ POST   │ /api/chat/sessions/:id/abort    │ Abort AI response                │                                                 
 ├────────┼─────────────────────────────────┼──────────────────────────────────┤                                                 
 │ GET    │ /api/chat/sessions/:id/events   │ SSE stream for real-time updates │                                                 
 └────────┴─────────────────────────────────┴──────────────────────────────────┘                                                 
 4. Register Router                                                                                                              
                                                                                                                                 
 File: src/index.ts - Add:                                                                                                       
 import chatRouter from './chat';                                                                                                
 apiRouter.use('/chat', chatRouter);                                                                                             
                                                                                                                                 
 Frontend Changes                                                                                                                
                                                                                                                                 
 1. Component Structure                                                                                                          
                                                                                                                                 
 frontend/src/components/dashboard/chat/                                                                                         
 ├── ChatContainer.tsx    # Main state management, SSE connection                                                                
 ├── MessageList.tsx      # Displays messages with auto-scroll                                                                   
 ├── MessageItem.tsx      # Individual message (user vs assistant)                                                               
 ├── MessagePart.tsx      # Renders text, tool, file parts                                                                       
 ├── ChatInput.tsx        # Input form with send button                                                                          
 ├── SessionSidebar.tsx   # Session list and new session button                                                                  
 ├── ToolCallDisplay.tsx  # Tool execution visualization                                                                         
 └── Chat.css             # Styles                                                                                               
                                                                                                                                 
 2. Update AIModeSection.tsx                                                                                                     
                                                                                                                                 
 Replace placeholder with <ChatContainer /> component.                                                                           
                                                                                                                                 
 3. TypeScript Types                                                                                                             
                                                                                                                                 
 File: frontend/src/types/chat.ts                                                                                                
                                                                                                                                 
 Define types for Session, Message, Part (TextPart, ToolPart, FilePart, etc.) based on SDK types.                                
                                                                                                                                 
 4. Real-Time Updates                                                                                                            
                                                                                                                                 
 Use fetch with streaming (not EventSource) to support Authorization headers:                                                    
                                                                                                                                 
 const response = await fetch(`/api/chat/sessions/${sessionId}/events`, {                                                        
     headers: { 'Authorization': `Bearer ${token}` }                                                                             
 });                                                                                                                             
 const reader = response.body.getReader();                                                                                       
 // Process SSE stream...                                                                                                        
                                                                                                                                 
 Files to Modify                                                                                                                 
 ┌─────────────────────────────────────────────────────┬─────────────────────────────────────┐                                   
 │                        File                         │               Action                │                                   
 ├─────────────────────────────────────────────────────┼─────────────────────────────────────┤                                   
 │ src/utils/opencode-client.ts                        │ Create                              │                                   
 ├─────────────────────────────────────────────────────┼─────────────────────────────────────┤                                   
 │ src/chat/index.ts                                   │ Create                              │                                   
 ├─────────────────────────────────────────────────────┼─────────────────────────────────────┤                                   
 │ src/index.ts                                        │ Add chat router                     │                                   
 ├─────────────────────────────────────────────────────┼─────────────────────────────────────┤                                   
 │ prisma/schema.prisma                                │ Add chat_sessions table + migration │                                   
 ├─────────────────────────────────────────────────────┼─────────────────────────────────────┤                                   
 │ frontend/src/components/dashboard/chat/*            │ Create (7 files)                    │                                   
 ├─────────────────────────────────────────────────────┼─────────────────────────────────────┤                                   
 │ frontend/src/types/chat.ts                          │ Create                              │                                   
 ├─────────────────────────────────────────────────────┼─────────────────────────────────────┤                                   
 │ frontend/src/components/dashboard/AIModeSection.tsx │ Modify                              │                                   
 └─────────────────────────────────────────────────────┴─────────────────────────────────────┘                                   
 Implementation Order                                                                                                            
                                                                                                                                 
 1. Backend: Create opencode client utility                                                                                      
 2. Backend: Add chat routes (session CRUD, messaging)                                                                           
 3. Backend: Implement SSE endpoint                                                                                              
 4. Database: Add chat_sessions table (if needed)                                                                                
 5. Frontend: Create TypeScript types                                                                                            
 6. Frontend: Build ChatContainer with state management                                                                          
 7. Frontend: Build MessageList, MessageItem, MessagePart                                                                        
 8. Frontend: Build ChatInput                                                                                                    
 9. Frontend: Implement SSE client with fetch streaming                                                                          
 10. Frontend: Build SessionSidebar                                                                                              
 11. Frontend: Update AIModeSection to use ChatContainer                                                                         
                                                                                                                                 
 Verification                                                                                                                    
                                                                                                                                 
 1. Start backend: npm run dev                                                                                                   
 2. Start frontend: cd frontend && npm run dev                                                                                   
 3. Login and navigate to AI Mode tab                                                                                            
 4. Create a new session                                                                                                         
 5. Send a message and verify AI response streams in                                                                             
 6. Check session list updates                                                                                                   
 7. Test abort functionality                                                                                                     
 8. Test session switching 