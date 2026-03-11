# Website for TeamCopilot.ai

This is a marketing and documentation website for the product. The product's actual frontend is in the /frontend directory.

## Analytics

PostHog is wired into the Next.js app through `app/components/PostHogProvider.tsx`.

Set these environment variables before running the site:

- `NEXT_PUBLIC_POSTHOG_TOKEN`
- `NEXT_PUBLIC_POSTHOG_HOST` (for example `https://us.i.posthog.com`)
