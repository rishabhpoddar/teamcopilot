import axios from 'axios'
import { signOut } from './lib/auth'
import type { Message, Part } from './types/chat'

export const axiosInstance = axios.create({
    headers: {
        'Content-Type': 'application/json',
    },
})

export const axiosUploadInstance = axios.create()

function attachAuthRedirectInterceptor(instance: typeof axiosInstance) {
    instance.interceptors.response.use(
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
}

attachAuthRedirectInterceptor(axiosInstance)
attachAuthRedirectInterceptor(axiosUploadInstance)

type SessionStatus = 'busy' | 'retry' | 'idle'
type MessagesPayload = Array<{ info: Message; parts: Part[] }>

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

export type SessionMessagesPageResponse = {
    messages: MessagesPayload;
    session_status: SessionStatus;
    has_more: boolean;
    next_cursor: string | null;
};

export function assertSessionMessagesPageResponse(value: unknown): SessionMessagesPageResponse {
    if (!value || typeof value !== 'object') {
        throw new Error('Invalid session messages page response from /messages');
    }
    const candidate = value as {
        messages?: unknown;
        session_status?: unknown;
        has_more?: unknown;
        next_cursor?: unknown;
    };
    return {
        messages: assertMessagesPayload(candidate.messages),
        session_status: assertSessionStatus(candidate.session_status),
        has_more: candidate.has_more === true,
        next_cursor: typeof candidate.next_cursor === 'string' ? candidate.next_cursor : null,
    };
}
