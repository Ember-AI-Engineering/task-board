import logging
import re
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

# ─── ADAPT THESE IMPORTS TO YOUR APP ───
# Replace these with your app's auth and database dependencies.
from app.dependencies.tenant import get_central_db, get_current_user, get_tenant_db

from app.models.taskboard import (
    TASK_PRIORITIES,
    TASK_STATUSES,
    CreateCommentRequest,
    CreateTaskRequest,
    EditCommentRequest,
    UpdateTaskRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/taskboard", tags=["taskboard"])

POSITION_GAP = 1000


def _serialize_doc(doc: dict) -> dict:
    """Convert MongoDB document to JSON-serializable dict."""
    doc["id"] = str(doc.pop("_id"))
    if "task_id" in doc and isinstance(doc["task_id"], ObjectId):
        doc["task_id"] = str(doc["task_id"])
    # Normalize legacy string descriptions to structured format
    if "description" in doc and isinstance(doc["description"], str):
        old = doc["description"]
        doc["description"] = {
            "problem": old,
            "user_story": "",
            "proposed_behavior": "",
            "acceptance_criteria": "",
            "open_questions": "",
        }
    return doc


MENTION_RE = re.compile(r"@\[(.+?)\]\((.+?)\)")


def _extract_mentions(text: str) -> list[str]:
    """Extract usernames from @[Name](username) formatted text."""
    return [m.group(2) for m in MENTION_RE.finditer(text)]


async def _create_mention_notifications(
    db,
    text: str,
    actor_username: str,
    actor_name: str,
    task_id: ObjectId,
    task_title: str,
    project_slug: str,
    context: str = "comment",
):
    """Parse mentions from text and create notifications for each mentioned user."""
    mentioned = _extract_mentions(text)
    if not mentioned:
        return

    # Don't notify yourself
    recipients = [u for u in mentioned if u != actor_username]
    if not recipients:
        return

    # Build a short snippet (strip mention markup)
    snippet = MENTION_RE.sub(r"@\1", text)[:120]

    now = datetime.now(timezone.utc)
    notifications = [
        {
            "recipient": r,
            "type": "mention",
            "context": context,
            "actor_username": actor_username,
            "actor_name": actor_name,
            "task_id": task_id,
            "task_title": task_title,
            "project_slug": project_slug,
            "snippet": snippet,
            "read": False,
            "created_at": now,
        }
        for r in recipients
    ]
    await db.taskboard_notifications.insert_many(notifications)


# ─── Tasks ───


DEFAULT_PAGE_SIZE = 10


@router.get("/tasks")
async def list_tasks(
    project_slug: str = Query(..., description="Project slug"),
    per_column: int = Query(DEFAULT_PAGE_SIZE, description="Tasks per column (initial load)"),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Return tasks for a project, grouped by status, with pagination metadata."""
    # Verify user has access to this project
    user_apps = current_user.get("apps", [])
    if "all" not in user_apps and project_slug not in user_apps:
        raise HTTPException(status_code=403, detail="You do not have access to this project")

    cursor = db.taskboard_tasks.find({"project_slug": project_slug}).sort("position", 1)
    tasks = await cursor.to_list(length=5000)

    # Batch-fetch user's read timestamps for these tasks
    task_ids = [t["_id"] for t in tasks]
    username = current_user.get("username", "")
    read_cursor = db.taskboard_user_reads.find(
        {"task_id": {"$in": task_ids}, "username": username}
    )
    reads = await read_cursor.to_list(length=len(task_ids) + 1)
    read_map = {str(r["task_id"]): r["last_read_at"] for r in reads}

    # Group all tasks and apply per-column limit
    is_internal_user = current_user.get("is_internal", False)
    all_grouped: dict[str, list] = {s: [] for s in TASK_STATUSES}
    for task in tasks:
        task_status = task.get("status", "backlog")
        if task_status in all_grouped:
            serialized = _serialize_doc(task)
            last_read = read_map.get(serialized["id"])
            updated_at = task.get("updated_at")
            serialized["has_unread"] = (
                last_read is None
                or (updated_at is not None and updated_at > last_read)
            )
            # Internal users see total comment count (public + internal)
            if is_internal_user:
                serialized["comment_count"] = (
                    serialized.get("comment_count", 0)
                    + serialized.get("internal_comment_count", 0)
                )
            all_grouped[task_status].append(serialized)

    # Return first N per column + total counts + unread counts
    result = {}
    for s in TASK_STATUSES:
        all_items = all_grouped[s]
        result[s] = {
            "tasks": all_items[:per_column],
            "total": len(all_items),
            "unread": sum(1 for t in all_items if t.get("has_unread")),
        }

    return result


@router.get("/tasks/column")
async def list_column_tasks(
    project_slug: str = Query(..., description="Project slug"),
    status_key: str = Query(..., description="Column status key"),
    offset: int = Query(0, description="Skip N tasks"),
    limit: int = Query(DEFAULT_PAGE_SIZE, description="Number of tasks to return"),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Return paginated tasks for a specific column."""
    user_apps = current_user.get("apps", [])
    if "all" not in user_apps and project_slug not in user_apps:
        raise HTTPException(status_code=403, detail="You do not have access to this project")

    if status_key not in TASK_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status: {status_key}")

    cursor = (
        db.taskboard_tasks.find({"project_slug": project_slug, "status": status_key})
        .sort("position", 1)
        .skip(offset)
        .limit(limit)
    )
    tasks = await cursor.to_list(length=limit)

    # Batch-fetch read timestamps
    task_ids = [t["_id"] for t in tasks]
    username = current_user.get("username", "")
    read_cursor = db.taskboard_user_reads.find(
        {"task_id": {"$in": task_ids}, "username": username}
    )
    reads = await read_cursor.to_list(length=len(task_ids) + 1)
    read_map = {str(r["task_id"]): r["last_read_at"] for r in reads}

    result = []
    for task in tasks:
        serialized = _serialize_doc(task)
        last_read = read_map.get(serialized["id"])
        updated_at = task.get("updated_at")
        serialized["has_unread"] = (
            last_read is None
            or (updated_at is not None and updated_at > last_read)
        )
        result.append(serialized)

    return result


@router.post("/tasks", status_code=status.HTTP_201_CREATED)
async def create_task(
    body: CreateTaskRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Create a new task in the specified column (defaults to Backlog)."""
    if body.priority not in TASK_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority: {body.priority}")

    task_status = body.status if body.status in TASK_STATUSES else "backlog"

    # Verify user has access to this project
    user_apps = current_user.get("apps", [])
    if "all" not in user_apps and body.project_slug not in user_apps:
        raise HTTPException(status_code=403, detail="You do not have access to this project")

    # Calculate position: place at top of target column
    first_task = await db.taskboard_tasks.find_one(
        {"project_slug": body.project_slug, "status": task_status},
        sort=[("position", 1)],
    )
    position = (first_task["position"] - POSITION_GAP) if first_task else POSITION_GAP

    now = datetime.now(timezone.utc)
    doc = {
        "project_slug": body.project_slug,
        "title": body.title.strip(),
        "description": body.description.model_dump() if body.description else {
            "problem": "", "user_story": "", "proposed_behavior": "",
            "acceptance_criteria": "", "open_questions": "",
        },
        "status": task_status,
        "priority": body.priority,
        "position": position,
        "created_by": current_user.get("username", ""),
        "created_by_name": current_user.get("name", ""),
        "comment_count": 0,
        "tags": body.tags,
        "created_at": now,
        "updated_at": now,
    }

    result = await db.taskboard_tasks.insert_one(doc)
    doc["_id"] = result.inserted_id

    # Mark as read for the creator so it doesn't show as unread to them
    await db.taskboard_user_reads.update_one(
        {"task_id": result.inserted_id, "username": current_user.get("username", "")},
        {"$set": {"last_read_at": now}},
        upsert=True,
    )

    # Log task creation as activity
    await db.taskboard_activity.insert_one({
        "task_id": result.inserted_id,
        "type": "created",
        "from_status": None,
        "to_status": task_status,
        "user": current_user.get("username", ""),
        "user_name": current_user.get("name", ""),
        "created_at": now,
    })

    return _serialize_doc(doc)


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Get task detail with comments."""
    try:
        tid = ObjectId(task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    task = await db.taskboard_tasks.find_one({"_id": tid})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Fetch comments — filter internal comments for non-internal users
    is_internal_user = current_user.get("is_internal", False)
    comment_filter: dict = {"task_id": tid}
    if not is_internal_user:
        comment_filter["$or"] = [{"is_internal": False}, {"is_internal": {"$exists": False}}]

    cursor = db.taskboard_comments.find(comment_filter).sort("created_at", 1)
    comments = await cursor.to_list(length=500)

    # Fetch activity (status changes)
    activity_cursor = db.taskboard_activity.find({"task_id": tid}).sort("created_at", 1)
    activity = await activity_cursor.to_list(length=500)

    result = _serialize_doc(task)
    result["comments"] = [_serialize_doc(c) for c in comments]
    result["activity"] = [_serialize_doc(a) for a in activity]
    return result


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: str,
    body: UpdateTaskRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Partial update a task (title, description, priority, status, position)."""
    try:
        tid = ObjectId(task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    task = await db.taskboard_tasks.find_one({"_id": tid})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update: dict = {"updated_at": datetime.now(timezone.utc)}

    if body.title is not None:
        update["title"] = body.title.strip()
    if body.description is not None:
        update["description"] = body.description.model_dump()
    if body.priority is not None:
        if body.priority not in TASK_PRIORITIES:
            raise HTTPException(status_code=400, detail=f"Invalid priority: {body.priority}")
        update["priority"] = body.priority
    old_status = task.get("status")
    if body.status is not None:
        if body.status not in TASK_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
        update["status"] = body.status
    if body.position is not None:
        update["position"] = body.position
    if body.tags is not None:
        update["tags"] = body.tags

    await db.taskboard_tasks.update_one({"_id": tid}, {"$set": update})

    # Log status change as activity
    if body.status is not None and body.status != old_status:
        now = datetime.now(timezone.utc)
        await db.taskboard_activity.insert_one({
            "task_id": tid,
            "type": "status_change",
            "from_status": old_status,
            "to_status": body.status,
            "user": current_user.get("username", ""),
            "user_name": current_user.get("name", ""),
            "created_at": now,
        })

    # Create notifications for new @mentions in description
    if body.description is not None:
        # Combine all description fields for mention extraction
        old_desc = task.get("description", "")
        old_text = " ".join(old_desc.values()) if isinstance(old_desc, dict) else str(old_desc)
        new_text = " ".join(body.description.model_dump().values())
        old_mentions = set(_extract_mentions(old_text))
        new_mentions = set(_extract_mentions(new_text))
        added_mentions = new_mentions - old_mentions
        if added_mentions:
            await _create_mention_notifications(
                db,
                text=new_text,
                actor_username=current_user.get("username", ""),
                actor_name=current_user.get("name", ""),
                task_id=tid,
                task_title=task.get("title", ""),
                project_slug=task.get("project_slug", ""),
                context="description",
            )

    updated = await db.taskboard_tasks.find_one({"_id": tid})
    return _serialize_doc(updated)


@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Delete a task and its comments."""
    try:
        tid = ObjectId(task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    result = await db.taskboard_tasks.delete_one({"_id": tid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")

    # Clean up comments and read records
    await db.taskboard_comments.delete_many({"task_id": tid})
    await db.taskboard_user_reads.delete_many({"task_id": tid})

    return {"success": True}


# ─── Read Tracking ───


@router.post("/tasks/{task_id}/read", status_code=status.HTTP_200_OK)
async def mark_task_read(
    task_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Mark a task as read for the current user."""
    try:
        tid = ObjectId(task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    now = datetime.now(timezone.utc)
    await db.taskboard_user_reads.update_one(
        {"task_id": tid, "username": current_user.get("username", "")},
        {"$set": {"last_read_at": now}},
        upsert=True,
    )
    return {"success": True}


# ─── Comments ───


@router.post("/tasks/{task_id}/comments", status_code=status.HTTP_201_CREATED)
async def add_comment(
    task_id: str,
    body: CreateCommentRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Add a comment to a task."""
    try:
        tid = ObjectId(task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    task = await db.taskboard_tasks.find_one({"_id": tid})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    now = datetime.now(timezone.utc)

    # Only internal users can create internal comments
    is_internal_comment = body.is_internal and current_user.get("is_internal", False)

    comment = {
        "task_id": tid,
        "content": body.content.strip(),
        "author_id": current_user.get("username", ""),
        "author_name": current_user.get("name", ""),
        "is_internal": is_internal_comment,
        "created_at": now,
    }

    result = await db.taskboard_comments.insert_one(comment)
    comment["_id"] = result.inserted_id

    # Increment the appropriate comment count on the task
    inc_fields: dict = {}
    if is_internal_comment:
        inc_fields["internal_comment_count"] = 1
    else:
        inc_fields["comment_count"] = 1

    update_fields: dict = {"updated_at": now}
    # Internal comments should not bump updated_at for external users
    if is_internal_comment:
        update_fields = {}

    update_op: dict = {"$inc": inc_fields}
    if update_fields:
        update_op["$set"] = update_fields

    await db.taskboard_tasks.update_one({"_id": tid}, update_op)

    # Create notifications for @mentions in comment
    await _create_mention_notifications(
        db,
        text=body.content.strip(),
        actor_username=current_user.get("username", ""),
        actor_name=current_user.get("name", ""),
        task_id=tid,
        task_title=task.get("title", ""),
        project_slug=task.get("project_slug", ""),
        context="comment",
    )

    return _serialize_doc(comment)


@router.get("/tasks/{task_id}/comments")
async def list_comments(
    task_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """List comments for a task in chronological order."""
    try:
        tid = ObjectId(task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    is_internal_user = current_user.get("is_internal", False)
    comment_filter: dict = {"task_id": tid}
    if not is_internal_user:
        comment_filter["$or"] = [{"is_internal": False}, {"is_internal": {"$exists": False}}]

    cursor = db.taskboard_comments.find(comment_filter).sort("created_at", 1)
    comments = await cursor.to_list(length=500)

    return [_serialize_doc(c) for c in comments]


@router.patch("/tasks/{task_id}/comments/{comment_id}")
async def edit_comment(
    task_id: str,
    comment_id: str,
    body: EditCommentRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Edit a comment. Only the author can edit."""
    try:
        tid = ObjectId(task_id)
        cid = ObjectId(comment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")

    comment = await db.taskboard_comments.find_one({"_id": cid, "task_id": tid})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    username = current_user.get("username", "")
    if comment.get("author_id") != username:
        raise HTTPException(status_code=403, detail="Only the author can edit this comment")

    now = datetime.now(timezone.utc)
    await db.taskboard_comments.update_one(
        {"_id": cid},
        {"$set": {"content": body.content.strip(), "edited": True, "edited_at": now}},
    )

    updated = await db.taskboard_comments.find_one({"_id": cid})
    return _serialize_doc(updated)


@router.delete("/tasks/{task_id}/comments/{comment_id}", status_code=status.HTTP_200_OK)
async def delete_comment(
    task_id: str,
    comment_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Delete a comment. Users can delete their own comments; admins can delete any."""
    try:
        tid = ObjectId(task_id)
        cid = ObjectId(comment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")

    comment = await db.taskboard_comments.find_one({"_id": cid, "task_id": tid})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Only allow the author or admins to delete
    username = current_user.get("username", "")
    is_author = comment.get("author_id") == username
    is_admin = current_user.get("role") in ("super_admin", "org_admin")

    if not is_author and not is_admin:
        raise HTTPException(status_code=403, detail="Not authorized to delete this comment")

    await db.taskboard_comments.delete_one({"_id": cid})

    # Decrement the appropriate comment count on task
    was_internal = comment.get("is_internal", False)
    now = datetime.now(timezone.utc)
    inc_field = "internal_comment_count" if was_internal else "comment_count"
    update_op: dict = {"$inc": {inc_field: -1}}
    if not was_internal:
        update_op["$set"] = {"updated_at": now}
    await db.taskboard_tasks.update_one({"_id": tid}, update_op)

    return {"detail": "Comment deleted"}


# ─── Mentions ───


@router.get("/mentions/users")
async def list_mentionable_users(
    q: str = Query("", description="Search filter"),
    current_user: dict = Depends(get_current_user),
    central=Depends(get_central_db),
):
    """Return users in the same org for @mention suggestions."""
    org_slug = current_user.get("org_slug", "")

    query_filter: dict = {"org_slug": org_slug}
    if q.strip():
        # Case-insensitive search on name or username
        regex = {"$regex": q.strip(), "$options": "i"}
        query_filter["$or"] = [{"name": regex}, {"username": regex}]

    cursor = central.users.find(
        query_filter,
        {"_id": 0, "username": 1, "name": 1, "email": 1},
    ).sort("name", 1).limit(20)

    users = await cursor.to_list(length=20)
    return users


# ─── Notifications ───


@router.get("/notifications/count")
async def notification_count(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Return the unread notification count for the current user."""
    username = current_user.get("username", "")
    count = await db.taskboard_notifications.count_documents(
        {"recipient": username, "read": False}
    )
    return {"count": count}


@router.get("/notifications")
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(30, le=100),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Return notifications for the current user, newest first."""
    username = current_user.get("username", "")
    query: dict = {"recipient": username}
    if unread_only:
        query["read"] = False

    cursor = (
        db.taskboard_notifications.find(query)
        .sort("created_at", -1)
        .limit(limit)
    )
    notifications = await cursor.to_list(length=limit)

    for n in notifications:
        n["id"] = str(n.pop("_id"))
        if "task_id" in n and isinstance(n["task_id"], ObjectId):
            n["task_id"] = str(n["task_id"])
    return notifications


@router.patch("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Mark a single notification as read."""
    try:
        nid = ObjectId(notification_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")

    result = await db.taskboard_notifications.update_one(
        {"_id": nid, "recipient": current_user.get("username", "")},
        {"$set": {"read": True}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"detail": "Marked as read"}


@router.post("/notifications/read-all")
async def mark_all_read(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_tenant_db),
):
    """Mark all notifications as read for the current user."""
    username = current_user.get("username", "")
    await db.taskboard_notifications.update_many(
        {"recipient": username, "read": False},
        {"$set": {"read": True}},
    )
    return {"detail": "All marked as read"}
