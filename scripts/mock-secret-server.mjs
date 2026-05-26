#!/usr/bin/env node

import http from "node:http"

const PORT = Number.parseInt(process.env.MOCK_SECRET_SERVER_PORT ?? "5789", 10)
const AUTH_TOKEN = process.env.MOCK_SECRET_SERVER_TOKEN ?? "teamcopilot-test-token"

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => {
      chunks.push(chunk)
    })
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      if (!raw) {
        resolve("")
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
    req.on("error", reject)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  })
  res.end(body)
}

function unauthorized(res) {
  sendJson(res, 401, { message: "Unauthorized" })
}

function authOk(req) {
  const header = req.headers.authorization ?? ""
  return header === `Bearer ${AUTH_TOKEN}`
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${PORT}`}`)

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/users/me/resolve-secrets") {
    if (!authOk(req)) {
      unauthorized(res)
      return
    }

    try {
      const body = await readBody(req)
      const keys = Array.isArray(body?.keys) ? body.keys : []
      const secretMap = {}
      for (const key of keys) {
        if (typeof key !== "string" || !key.trim()) continue
        const normalized = key.trim().toUpperCase()
        secretMap[normalized] = `resolved-value-for-${normalized.toLowerCase()}`
      }
      sendJson(res, 200, { secret_map: secretMap })
    } catch (error) {
      sendJson(res, 400, { message: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  sendJson(res, 404, { message: "Not found" })
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-secret-server listening on http://127.0.0.1:${PORT}`)
  console.log(`auth token: ${AUTH_TOKEN}`)
})

process.on("SIGINT", () => {
  server.close(() => process.exit(0))
})

process.on("SIGTERM", () => {
  server.close(() => process.exit(0))
})
