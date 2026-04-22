from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TaskStatus(str, Enum):
    todo = "todo"
    in_progress = "in_progress"
    blocked = "blocked"
    completed = "completed"


class TaskPriority(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


class TaskAssigneeType(str, Enum):
    user = "user"
    team = "team"


class TaskAssigneeInput(BaseModel):
    assignee_type: TaskAssigneeType
    user_id: int | None = None
    team_id: int | None = None

    @model_validator(mode="after")
    def validate_target(self):
        if self.assignee_type == TaskAssigneeType.user and not self.user_id:
            raise ValueError("user_id is required for user assignees")
        if self.assignee_type == TaskAssigneeType.team and not self.team_id:
            raise ValueError("team_id is required for team assignees")
        if self.assignee_type == TaskAssigneeType.user:
            self.team_id = None
        if self.assignee_type == TaskAssigneeType.team:
            self.user_id = None
        return self


class TaskAssigneeResponse(BaseModel):
    assignee_type: TaskAssigneeType
    assignee_key: str
    user_id: int | None = None
    team_id: int | None = None
    label: str

    model_config = ConfigDict(from_attributes=True)


class TaskBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    status: TaskStatus = TaskStatus.todo
    priority: TaskPriority = TaskPriority.medium
    start_at: datetime | None = None
    due_at: datetime | None = None
    completed_at: datetime | None = None
    assignees: list[TaskAssigneeInput] = Field(default_factory=list)


class TaskCreateRequest(TaskBase):
    pass


class TaskUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    start_at: datetime | None = None
    due_at: datetime | None = None
    completed_at: datetime | None = None
    assignees: list[TaskAssigneeInput] | None = None


class TaskResponse(BaseModel):
    id: int
    title: str
    description: str | None = None
    status: TaskStatus
    priority: TaskPriority
    start_at: datetime | None = None
    due_at: datetime | None = None
    completed_at: datetime | None = None
    created_by_user_id: int | None = None
    updated_by_user_id: int | None = None
    created_by_name: str | None = None
    updated_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    assignees: list[TaskAssigneeResponse]


class TaskListResponse(BaseModel):
    results: list[TaskResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
    page_size: int


class TaskAssignmentUserOption(BaseModel):
    id: int
    name: str
    email: str | None = None
    team_id: int | None = None
    team_name: str | None = None


class TaskAssignmentTeamOption(BaseModel):
    id: int
    name: str
    department_id: int | None = None


class TaskAssignmentOptionsResponse(BaseModel):
    users: list[TaskAssignmentUserOption]
    teams: list[TaskAssignmentTeamOption]
