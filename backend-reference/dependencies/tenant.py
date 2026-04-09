"""
Reference auth/tenant dependency for the task board backend.

ADAPT THIS FILE to your app's auth and database setup:
  - Replace `decode_token` with your app's JWT/session verification
  - Replace `DatabaseManager` with your app's database connection layer
  - Adjust the user dict fields to match what your auth system provides

The task board API expects these fields in the user dict:
  - username (str): Unique identifier
  - name (str): Display name
  - email (str): Email address
  - role (str): User role (e.g., "user", "org_admin", "super_admin")
  - apps (list[str]): Project slugs the user can access, or ["all"]
  - org_slug (str): Organization identifier for tenant isolation
  - is_reviewer (bool): Whether user has reviewer privileges
  - is_internal (bool): Whether user can see internal comments
"""

from fastapi import Depends, HTTPException, Request, status
from motor.motor_asyncio import AsyncIOMotorDatabase

# ─── REPLACE THESE WITH YOUR APP'S IMPORTS ───
from app.core.security import decode_token
from app.db.mongodb import DatabaseManager


async def get_current_user(request: Request) -> dict:
    """
    Extract and validate the current user from the signed JWT.
    Returns user dict including org_slug for tenant resolution.
    """
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    return {
        "username": payload.get("username", ""),
        "name": payload.get("name", ""),
        "email": payload.get("email", ""),
        "role": payload.get("role", "user"),
        "apps": payload.get("apps", ["all"]),
        "org_id": payload.get("org_id", ""),
        "org_slug": payload.get("org_slug", ""),
        "is_reviewer": payload.get("is_reviewer", False),
        "is_internal": payload.get("is_internal", False),
    }


async def get_central_db() -> AsyncIOMotorDatabase:
    """Dependency: Get the central (shared) database for auth/user/org operations."""
    return DatabaseManager.get_instance().get_central_db()


async def get_tenant_db(
    current_user: dict = Depends(get_current_user),
) -> AsyncIOMotorDatabase:
    """
    Dependency: Get the tenant-scoped database for the current user.
    All data routes (tasks, comments, notifications) use this.
    """
    org_slug = current_user.get("org_slug")
    if not org_slug:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not associated with an organization",
        )
    return DatabaseManager.get_instance().get_client_db(org_slug)
