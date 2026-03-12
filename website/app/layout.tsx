import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { getSiteUrl } from "./site-config";
import PostHogProvider from "./components/PostHogProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TeamCopilot - A Shared AI Agent for Teams",
  description: "Think Claude Code, but shared across your entire team and running on your cloud. Configure once, the whole team can use it.",
  metadataBase: new URL(getSiteUrl()),
  openGraph: {
    title: "TeamCopilot - A Shared AI Agent for Teams",
    description: "Think Claude Code, but shared across your entire team and running on your cloud. Configure once, the whole team can use it.",
    url: getSiteUrl(),
    siteName: "TeamCopilot",
    images: [
      {
        url: "/social-preview.png",
        width: 1200,
        height: 630,
        alt: "TeamCopilot: A shared AI agent for Teams",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TeamCopilot - A Shared AI Agent for Teams",
    description: "Think Claude Code, but shared across your entire team and running on your cloud. Configure once, the whole team can use it.",
    images: ["/social-preview.png"],
  },
  icons: {
    icon: "/logo.svg",
    shortcut: "/logo.svg",
    apple: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <Script
          async
          src="https://www.googletagmanager.com/gtag/js?id=AW-17338433804"
          strategy="afterInteractive"
        />
        <Script id="google-ads-gtag" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'AW-17338433804');

            window.gtag_report_conversion = function (url) {
              var callback = function () {
                if (typeof(url) != 'undefined') {
                  window.location = url;
                }
              };
              gtag('event', 'conversion', {
                'send_to': 'AW-17338433804/RPPeCPfuo-4aEIyCzstA',
                'value': 1.0,
                'currency': 'INR',
                'event_callback': callback
              });
              return false;
            };
          `}
        </Script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black`}
      >
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
