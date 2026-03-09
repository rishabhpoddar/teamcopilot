"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";

const navLinks = [
  { name: "Features", href: "#features", active: true },
  { name: "GitHub", href: "https://github.com/rishabhpoddar/teamcopilot", active: false, external: true },
];

export default function Navbar() {
  return (
    <motion.nav
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-black/30 border-b border-white/10"
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-white font-medium tracking-tight text-xl">
          <Image src="/logo.svg" alt="TeamCopilot" width={32} height={32} />
          TeamCopilot
        </Link>

        {/* Navigation Links */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              className={`relative text-sm transition-colors ${
                link.active
                  ? "text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {link.name}
              {link.active && (
                <span className="absolute -bottom-1 left-0 right-0 h-[2px] bg-white rounded-full" />
              )}
            </a>
          ))}
        </div>

        {/* CTA Button */}
        <motion.a
          href="https://github.com/rishabhpoddar/teamcopilot"
          target="_blank"
          rel="noopener noreferrer"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="px-5 py-2.5 text-sm font-medium rounded-full bg-gradient-to-r from-white to-gray-300 text-black transition-all hover:shadow-lg hover:shadow-white/20"
        >
          Get Started
        </motion.a>
      </div>
    </motion.nav>
  );
}
