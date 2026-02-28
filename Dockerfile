FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY package*.json ./
COPY tsconfig.json ./
RUN npm install

# Copy prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy backend source and compile TypeScript
COPY src ./src
RUN npm run build

# Copy and build frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend ./frontend
RUN cd frontend && npm run build

# Workspace directory stores both workflows and the SQLite database
RUN mkdir -p /app/workspaces

# Default environment variables
ENV WORKSPACE_DIR="/app/workspaces"
ENV HOST="0.0.0.0"
ENV PORT="3000"
ENV OPENCODE_PORT="4096"
ENV OPENCODE_MODEL="anthropic/claude-sonnet-4-5-20250929"

EXPOSE 3000
CMD node dist/index.js
