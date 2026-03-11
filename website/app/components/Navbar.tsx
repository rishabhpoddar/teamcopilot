"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

const navLinks = [
  { name: "Features", href: "/#features", match: "home" },
  { name: "Use Cases", href: "/use-cases", match: "use-cases" },
  { name: "Book a Demo", href: "/book-demo", match: "book-demo" },
  { name: "Security", href: "/security", match: "security" },
  { name: "GitHub", href: "https://github.com/rishabhpoddar/teamcopilot", external: true },
];

export default function Navbar({
  currentPage = "home",
}: {
  currentPage?: "home" | "use-cases" | "book-demo" | "ai-automation-consulting" | "security";
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/30 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-white font-medium tracking-tight text-xl">
          <Image src="/logo.svg" alt="TeamCopilot" width={32} height={32} />
          TeamCopilot
        </Link>

        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            link.external ? (
              <a
                key={link.name}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="relative text-sm text-gray-400 transition-colors hover:text-white"
              >
                {link.name}
              </a>
            ) : (
              <Link
                key={link.name}
                href={link.href}
                className={`relative text-sm transition-colors ${
                  currentPage === link.match
                    ? "text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {link.name}
                {currentPage === link.match && (
                  <span className="absolute -bottom-1 left-0 right-0 h-[2px] bg-white rounded-full" />
                )}
              </Link>
            )
          ))}
        </div>

        <div className="flex items-center gap-4">
          {/* CTA Button */}
          <Link
            href="/book-demo"
            className="hidden sm:block px-5 py-2.5 text-sm font-medium rounded-full bg-gradient-to-r from-white to-gray-300 text-black transition-all hover:shadow-lg hover:shadow-white/20 hover:scale-[1.02] active:scale-[0.98]"
          >
            Book a Demo
          </Link>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-white"
            aria-label="Toggle menu"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {mobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/10 bg-black/95 backdrop-blur-md">
          <div className="px-6 py-4 flex flex-col gap-4">
            {navLinks.map((link) => (
              link.external ? (
                <a
                  key={link.name}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gray-400 transition-colors hover:text-white"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.name}
                </a>
              ) : (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`text-sm transition-colors ${
                    currentPage === link.match
                      ? "text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.name}
                </Link>
              )
            ))}
            <Link
              href="/book-demo"
              className="sm:hidden mt-2 px-5 py-2.5 text-sm font-medium rounded-full bg-gradient-to-r from-white to-gray-300 text-black text-center transition-all"
              onClick={() => setMobileMenuOpen(false)}
            >
              Book a Demo
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
