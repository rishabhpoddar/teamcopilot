# Website for TeamCopilot.ai

This is a marketing and documentation website for the product. The product's actual frontend is in the /frontend directory.

## Analytics

PostHog is wired into the Next.js app through `app/components/PostHogProvider.tsx`.

Set these environment variables before running the site:

- `NEXT_PUBLIC_POSTHOG_TOKEN`
- `NEXT_PUBLIC_POSTHOG_HOST` (for example `https://us.i.posthog.com`)

## Lead Capture

Both the demo and consulting pages submit through the shared Next.js API route at `POST /api/lead-capture`, which forwards requests to the hard-coded Formspree endpoint.
