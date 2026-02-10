import axios from 'axios'
import { signOut } from './lib/auth'

export const axiosInstance = axios.create({
    headers: {
        'Content-Type': 'application/json',
    },
})

axiosInstance.interceptors.response.use(
    response => response,
    error => {
        if (error.response?.status === 401) {
            signOut()
            window.location.href = '/login'
        }
        return Promise.reject(error)
    }
)