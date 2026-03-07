#!/usr/bin/env python3
"""Entrypoint for the CLI. Run from project root: python run_cli.py"""

import asyncio
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from src.app import main_cli, reset_all_memory

if __name__ == "__main__":
    if "--reset" in sys.argv or "-r" in sys.argv:
        reset_all_memory()
        print("\nMemory reset. Run again without --reset to start as a new user.")
        sys.exit(0)
    asyncio.run(main_cli())
