import { useEffect } from 'react'

const BASE_TITLE = 'TeamCopilot'

export function usePageTitle(suffix?: string) {
  useEffect(() => {
    const trimmed = typeof suffix === 'string' ? suffix.trim() : ''
    document.title = trimmed ? `${BASE_TITLE} - ${trimmed}` : BASE_TITLE
  }, [suffix])
}
