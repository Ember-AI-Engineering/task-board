"""
Seed the taskboard_projects collection with initial projects.

Usage:
    MONGODB_URI=<uri> python -m app.scripts.seed_projects --org-slug your-org

Idempotent: uses slug as unique key, skips existing projects.

ADAPT: Replace the PROJECTS list below with your app's projects.
"""

import argparse
import asyncio
import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── REPLACE WITH YOUR PROJECTS ───
PROJECTS = [
    {"name": "Project Alpha", "slug": "project-alpha", "description": "First project"},
    {"name": "Project Beta", "slug": "project-beta", "description": "Second project"},
]


async def seed_projects(mongodb_uri: str, org_slug: str):
    client = AsyncIOMotorClient(mongodb_uri)
    # Adapt the database name pattern to match your app
    db = client[f"taskboard-{org_slug}"]

    now = datetime.now(timezone.utc)
    created = 0
    skipped = 0

    for project in PROJECTS:
        existing = await db.taskboard_projects.find_one({"slug": project["slug"]})
        if existing:
            logger.info(f"Skipping existing project: {project['name']}")
            skipped += 1
            continue

        await db.taskboard_projects.insert_one({
            **project,
            "created_at": now,
            "updated_at": now,
        })
        logger.info(f"Created project: {project['name']}")
        created += 1

    # Ensure unique index on slug
    await db.taskboard_projects.create_index("slug", unique=True)

    logger.info(f"Seed complete: {created} created, {skipped} skipped")
    client.close()


def main():
    import os

    parser = argparse.ArgumentParser(description="Seed taskboard projects")
    parser.add_argument("--org-slug", required=True, help="Organization slug")
    args = parser.parse_args()

    mongodb_uri = os.environ.get("MONGODB_URI")
    if not mongodb_uri:
        logger.error("MONGODB_URI environment variable is required")
        return

    asyncio.run(seed_projects(mongodb_uri, args.org_slug))


if __name__ == "__main__":
    main()
