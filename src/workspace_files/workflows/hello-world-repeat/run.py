#!/usr/bin/env python3
"""
Hello World Repeat Workflow
Prints a hello world message a specified number of times.
"""

import argparse


def main():
    parser = argparse.ArgumentParser(
        description="Print hello world message multiple times"
    )
    parser.add_argument(
        "--count",
        type=int,
        default=3,
        help="Number of times to print the message (default: 3)"
    )
    args = parser.parse_args()
    
    # Validate count
    if args.count < 1:
        print("Error: count must be at least 1")
        return 1
    
    if args.count > 100:
        print("Error: count must be 100 or less")
        return 1
    
    # Print the message
    for i in range(1, args.count + 1):
        print(f"[{i}/{args.count}] Hello, World!")
    
    print(f"\nCompleted! Printed the message {args.count} time(s).")
    return 0


if __name__ == "__main__":
    exit(main())
