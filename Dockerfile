FROM python:3.14.3-slim-bookworm AS python-runtime

FROM node:20-bookworm-slim

# Install fixed Python runtime (3.14.3) and pip from official Python image
COPY --from=python-runtime /usr/local /usr/local
RUN ln -sf /usr/local/bin/python3 /usr/local/bin/python \
    && ln -sf /usr/local/bin/pip3 /usr/local/bin/pip

WORKDIR /app

# Install backend dependencies
COPY package*.json ./
COPY tsconfig.json ./
RUN npm install

# Install frontend dependencies
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install

# Copy prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source and compile (root build also builds frontend)
COPY src ./src
COPY frontend ./frontend
RUN npm run build

# Workspace directory stores both workflows and the SQLite database
RUN mkdir -p /app/workspaces

# Default environment variables
ENV WORKSPACE_DIR="/app/workspaces"
ENV HOST="0.0.0.0"
ENV PORT="5124"
ENV OPENCODE_PORT="4096"
ENV OPENCODE_MODEL="openai/gpt-5.3-codex"
ENV PATH="/app/node_modules/.bin:${PATH}"

EXPOSE 5124
CMD node dist/index.js
