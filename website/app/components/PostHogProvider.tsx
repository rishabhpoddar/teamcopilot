"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PostHogReactProvider } from "posthog-js/react";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_TOKEN;
const posthogHost =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
let hasInitializedPostHog = false;

if (typeof window !== "undefined" && posthogKey && !hasInitializedPostHog) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    ui_host: posthogHost,
    capture_pageleave: true,
    capture_pageview: false,
    person_profiles: "identified_only",
  });
  hasInitializedPostHog = true;
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthogKey || !pathname) {
      return;
    }

    const search = searchParams.toString();
    const url = `${window.location.origin}${pathname}${search ? `?${search}` : ""}`;

    posthog.capture("$pageview", {
      $current_url: url,
    });
  }, [pathname, searchParams]);

  return null;
}

export default function PostHogProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!posthogKey) {
    return <>{children}</>;
  }

  return (
    <PostHogReactProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PostHogReactProvider>
  );
}
