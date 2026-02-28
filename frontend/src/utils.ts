import axios from 'axios'
import { signOut } from './lib/auth'
import type { Message, Part } from './types/chat'

export const axiosInstance = axios.create({
    headers: {
        'Content-Type': 'application/json',
    },
})

axiosInstance.interceptors.response.use(
    response => response,
    error => {
        const requestUrl = error.config?.url as string | undefined
        const isAuthEndpoint = typeof requestUrl === 'string' && requestUrl.startsWith('/api/auth/')

        if (error.response?.status === 401 && !isAuthEndpoint) {
            signOut()
            window.location.href = '/login'
        }
        return Promise.reject(error)
    }
)

export type SessionStatus = 'busy' | 'retry' | 'idle'
export type MessagesPayload = Array<{ info: Message; parts: Part[] }>

export function assertSessionStatus(value: unknown): SessionStatus {
    if (value === 'busy' || value === 'retry' || value === 'idle') {
        return value
    }
    throw new Error(`Invalid session_status from /messages: ${String(value)}`)
}

export function assertMessagesPayload(value: unknown): MessagesPayload {
    if (Array.isArray(value)) {
        return value as MessagesPayload
    }
    throw new Error('Invalid messages payload from /messages')
}
