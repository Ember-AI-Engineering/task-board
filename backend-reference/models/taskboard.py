from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ─── Tasks ───

TASK_STATUSES = [
    "backlog",
    "queued",
    "in_progress",
    "in_testing",
    "client_review",
    "changes_requested",
    "blocked",
    "approved",
]

TASK_PRIORITIES = ["urgent", "high", "medium", "low"]


class StructuredDescription(BaseModel):
    problem: str = ""
    user_story: str = ""
    proposed_behavior: str = ""
    acceptance_criteria: str = ""
    open_questions: str = ""


class CreateTaskRequest(BaseModel):
    project_slug: str
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[StructuredDescription] = None
    priority: str = "medium"
    status: str = "backlog"
    tags: list[str] = []


class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[StructuredDescription] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    position: Optional[float] = None
    tags: Optional[list[str]] = None


class TaskResponse(BaseModel):
    id: str
    project_slug: str
    title: str
    description: str = ""
    status: str = "backlog"
    priority: str = "medium"
    position: float = 0
    created_by: str = ""
    created_by_name: str = ""
    comment_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ─── Comments ───

class CreateCommentRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)
    is_internal: bool = False


class EditCommentRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)


class CommentResponse(BaseModel):
    id: str
    task_id: str
    content: str
    author_id: str
    author_name: str
    edited: bool = False
    edited_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
