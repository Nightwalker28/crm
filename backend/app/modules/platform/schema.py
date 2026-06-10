from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ActivityLogResponse(BaseModel):
    id: int
    actor_user_id: int | None = None
    module_key: str
    entity_type: str
    entity_id: str
    action: str
    description: str | None = None
    before_state: dict[str, Any] | None = None
    after_state: dict[str, Any] | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ActivityLogListResponse(BaseModel):
    results: list[ActivityLogResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class CustomFieldDefinitionResponse(BaseModel):
    id: int
    module_key: str
    field_key: str
    label: str
    field_type: str
    placeholder: str | None = None
    help_text: str | None = None
    is_required: bool
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomFieldDefinitionCreateRequest(BaseModel):
    field_key: str
    label: str
    field_type: str
    placeholder: str | None = None
    help_text: str | None = None
    is_required: bool = False
    is_active: bool = True
    sort_order: int = 0


class CustomFieldDefinitionUpdateRequest(BaseModel):
    label: str | None = None
    field_type: str | None = None
    placeholder: str | None = None
    help_text: str | None = None
    is_required: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class ModuleFieldConfigResponse(BaseModel):
    id: int | None = None
    module_key: str
    field_key: str
    label: str
    field_type: str | None = None
    field_source: str = "system"
    is_enabled: bool = True
    is_protected: bool = False
    sort_order: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ModuleFieldConfigUpdateRequest(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=150)
    field_type: str | None = Field(default=None, max_length=50)
    field_source: str | None = Field(default=None, max_length=40)
    is_enabled: bool | None = None
    is_protected: bool | None = None
    sort_order: int | None = None


class DataTransferJobResponse(BaseModel):
    id: int
    actor_user_id: int | None = None
    module_key: str
    operation_type: str
    status: str
    mode: str
    summary: dict[str, Any] | None = None
    result_file_name: str | None = None
    result_media_type: str | None = None
    error_message: str | None = None
    progress_percent: int = 0
    progress_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DataTransferJobListResponse(BaseModel):
    results: list[DataTransferJobResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class DataTransferExecutionResponse(BaseModel):
    mode: str
    message: str
    job_id: int | None = None
    job_status: str | None = None


class DataTransferExportRequest(BaseModel):
    mode: str = "all"
    selected_ids: list[int] | None = None
    current_page_ids: list[int] | None = None
    search: str | None = None
    status: str | None = None
    visible_columns: list[str] | None = None
    field_keys: list[str] | None = None
    filters_all: list[dict[str, Any]] | None = None
    filters_any: list[dict[str, Any]] | None = None


class TenantBackupSettingsResponse(BaseModel):
    id: int
    tenant_id: int
    enabled: bool
    frequency: str
    scope: str
    selected_modules: list[str]
    retention_count: int
    destination: str
    include_documents: bool
    created_by_id: int | None = None
    updated_by_id: int | None = None
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class TenantBackupSettingsUpdateRequest(BaseModel):
    enabled: bool | None = None
    frequency: str | None = Field(default=None, max_length=20)
    scope: str | None = Field(default=None, max_length=30)
    selected_modules: list[str] | None = None
    retention_count: int | None = None
    destination: str | None = Field(default=None, max_length=30)
    include_documents: bool | None = None


class TenantBackupDestinationConnectionResponse(BaseModel):
    destination: str
    provider: str
    status: str
    account_email: str | None = None
    provider_root_name: str | None = None
    last_error: str | None = None
    updated_at: datetime


class TenantBackupDestinationConnectResponse(BaseModel):
    destination: str
    provider: str
    auth_url: str


class TenantBackupRunResponse(BaseModel):
    id: int
    tenant_id: int
    requested_by_user_id: int | None = None
    settings_id: int | None = None
    backup_type: str
    scope: str
    modules_included: list[str]
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    storage_ref: str | None = None
    size_bytes: int | None = None
    error_message: str | None = None
    destination: str
    destination_upload_status: str
    metadata_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TenantBackupRunListResponse(BaseModel):
    results: list[TenantBackupRunResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class TenantBackupRunCreateResponse(BaseModel):
    run: TenantBackupRunResponse
    message: str


class TenantBackupRunDeleteResponse(BaseModel):
    run: TenantBackupRunResponse
    message: str


class TenantRestorePreviewRequest(BaseModel):
    source_backup_run_id: int
    module_key: str = Field(min_length=1, max_length=100)


class TenantRestoreExecuteRequest(BaseModel):
    source_backup_run_id: int
    module_key: str = Field(min_length=1, max_length=100)
    mode: str = Field(max_length=30)
    confirmation: str | None = Field(default=None, max_length=200)


class TenantWholeRestorePreviewRequest(BaseModel):
    source_backup_run_id: int


class TenantWholeRestoreExecuteRequest(BaseModel):
    source_backup_run_id: int
    confirmation: str | None = Field(default=None, max_length=200)


class TenantRestoreRunResponse(BaseModel):
    id: int
    tenant_id: int
    actor_user_id: int | None = None
    source_backup_run_id: int | None = None
    restore_type: str
    module_key: str
    mode: str
    status: str
    summary: dict[str, Any]
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TenantRestorePreviewResponse(BaseModel):
    run: TenantRestoreRunResponse
    metadata: dict[str, Any]
    summary: dict[str, Any]


class TenantRestoreExecuteResponse(BaseModel):
    run: TenantRestoreRunResponse
    message: str


class ModuleReportField(BaseModel):
    key: str
    label: str
    field_type: str


class ModuleReportModule(BaseModel):
    module_key: str
    label: str
    dimensions: list[ModuleReportField]
    metrics: list[ModuleReportField]
    filter_fields: list[ModuleReportField]
    default_dimension: str | None = None


class ModuleReportModuleListResponse(BaseModel):
    results: list[ModuleReportModule]


class ModuleReportRow(BaseModel):
    key: str
    label: str
    count: int
    value: float


class ModuleReportResponse(BaseModel):
    module_key: str
    dimension: ModuleReportField
    metric: str
    metric_field: ModuleReportField | None = None
    total_count: int
    rows: list[ModuleReportRow]


class SavedModuleReportCreateRequest(BaseModel):
    module_key: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=150)
    config: dict[str, Any]


class SavedModuleReportUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    config: dict[str, Any] | None = None


class SavedModuleReportResponse(BaseModel):
    id: int
    module_key: str
    name: str
    config: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SavedModuleReportListResponse(BaseModel):
    results: list[SavedModuleReportResponse]


class ForecastBucket(BaseModel):
    key: str
    label: str
    count: int
    gross_pipeline_amount: Decimal
    weighted_pipeline_amount: Decimal
    commit_amount: Decimal
    best_case_amount: Decimal
    actual_revenue_amount: Decimal


class ForecastSummaryResponse(BaseModel):
    period_start: date
    period_end: date
    owner_id: int | None = None
    team_id: int | None = None
    pipeline_key: str | None = None
    gross_pipeline_amount: Decimal
    weighted_pipeline_amount: Decimal
    commit_amount: Decimal
    best_case_amount: Decimal
    actual_revenue_amount: Decimal
    open_opportunity_count: int
    won_opportunity_count: int
    by_stage: list[ForecastBucket]
    by_owner: list[ForecastBucket]
    by_team: list[ForecastBucket]
    generated_at: datetime


class ForecastSnapshotResponse(BaseModel):
    id: int
    period_start: date
    period_end: date
    owner_id: int | None = None
    team_id: int | None = None
    pipeline_key: str | None = None
    gross_pipeline_amount: Decimal
    weighted_pipeline_amount: Decimal
    commit_amount: Decimal
    best_case_amount: Decimal
    snapshot_json: dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserNotificationResponse(BaseModel):
    id: int
    user_id: int
    category: str
    title: str
    message: str
    status: str
    link_url: str | None = None
    metadata: dict[str, Any] | None = Field(default=None, alias="payload")
    read_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class UserNotificationListResponse(BaseModel):
    results: list[UserNotificationResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
    page_size: int
    unread_count: int


class NotificationChannelResponse(BaseModel):
    id: int
    provider: str
    channel_name: str | None = None
    webhook_url_masked: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class NotificationChannelCreateRequest(BaseModel):
    provider: str = Field(default="slack", min_length=1, max_length=40)
    webhook_url: str = Field(min_length=1)
    channel_name: str | None = Field(default=None, max_length=120)
    is_active: bool = True


class NotificationChannelUpdateRequest(BaseModel):
    provider: str | None = Field(default=None, min_length=1, max_length=40)
    webhook_url: str | None = Field(default=None, min_length=1)
    channel_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


class NotificationChannelListResponse(BaseModel):
    results: list[NotificationChannelResponse]


class NotificationChannelTestResponse(BaseModel):
    ok: bool
    message: str


class CrmEventDeliveryResponse(BaseModel):
    id: int
    channel_id: int
    provider: str
    status: str
    channel_name: str | None = None
    error_message: str | None = None
    delivered_at: datetime | None = None
    created_at: datetime


class CrmEventResponse(BaseModel):
    id: int
    actor_user_id: int | None = None
    event_type: str
    entity_type: str
    entity_id: str
    payload: dict[str, Any] | None = None
    created_at: datetime
    deliveries: list[CrmEventDeliveryResponse] = Field(default_factory=list)


class CrmEventListResponse(BaseModel):
    results: list[CrmEventResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
    page_size: int


class AutomationRuleResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    module_key: str | None = None
    enabled: bool
    trigger_event: str
    condition_mode: str = "all"
    conditions_json: list[dict[str, Any]]
    actions_json: list[dict[str, Any]]
    created_by_id: int | None = None
    updated_by_id: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AutomationRuleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str | None = None
    module_key: str | None = Field(default=None, max_length=100)
    enabled: bool = True
    trigger_event: str = Field(min_length=1, max_length=100)
    condition_mode: str = Field(default="all", pattern="^(all|any)$")
    conditions_json: list[dict[str, Any]] = Field(default_factory=list)
    actions_json: list[dict[str, Any]] = Field(default_factory=list)


class AutomationRuleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = None
    module_key: str | None = Field(default=None, max_length=100)
    enabled: bool | None = None
    trigger_event: str | None = Field(default=None, min_length=1, max_length=100)
    condition_mode: str | None = Field(default=None, pattern="^(all|any)$")
    conditions_json: list[dict[str, Any]] | None = None
    actions_json: list[dict[str, Any]] | None = None


class AutomationRuleListResponse(BaseModel):
    results: list[AutomationRuleResponse]


class AutomationRulePreviewRequest(BaseModel):
    name: str | None = Field(default=None, max_length=180)
    description: str | None = None
    module_key: str | None = Field(default=None, max_length=100)
    enabled: bool = True
    trigger_event: str = Field(min_length=1, max_length=100)
    condition_mode: str = Field(default="all", pattern="^(all|any)$")
    conditions_json: list[dict[str, Any]] = Field(default_factory=list)
    actions_json: list[dict[str, Any]] = Field(default_factory=list)


class AutomationRulePreviewActionResponse(BaseModel):
    index: int
    type: str
    label: str
    config: dict[str, Any]


class AutomationRulePreviewResponse(BaseModel):
    valid: bool
    can_enable: bool
    module_key: str | None = None
    trigger_event: str
    condition_mode: str
    condition_count: int
    action_count: int
    warnings: list[str]
    actions: list[AutomationRulePreviewActionResponse]


class AutomationRuleRunResponse(BaseModel):
    id: int
    rule_id: int
    rule_name: str | None = None
    event_id: int | None = None
    trigger_event_key: str | None = None
    source_module_key: str | None = None
    source_record_id: str | None = None
    source_label: str | None = None
    status: str
    input_json: dict[str, Any] | None = None
    result_json: dict[str, Any] | None = None
    step_results_json: list[dict[str, Any]] | None = None
    action_attempt_count: int = 0
    action_success_count: int = 0
    action_failed_count: int = 0
    error_message: str | None = None
    started_at: datetime
    finished_at: datetime | None = None
    completed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AutomationRuleRunListResponse(BaseModel):
    results: list[AutomationRuleRunResponse]


class AutomationRuleTriggerResponse(BaseModel):
    results: list[str]


class AutomationTriggerResponse(BaseModel):
    key: str
    module_key: str
    label: str
    description: str


class AutomationTriggerGroupResponse(BaseModel):
    module_key: str
    triggers: list[AutomationTriggerResponse]


class AutomationTriggerRegistryResponse(BaseModel):
    results: list[AutomationTriggerGroupResponse]


class AutomationConditionFieldOptionResponse(BaseModel):
    value: str
    label: str


class AutomationConditionFieldResponse(BaseModel):
    key: str
    payload_key: str
    module_key: str
    label: str
    field_type: str
    operators: list[str]
    options: list[AutomationConditionFieldOptionResponse]


class AutomationConditionFieldListResponse(BaseModel):
    results: list[AutomationConditionFieldResponse]


class AutomationActionFieldResponse(BaseModel):
    key: str
    label: str
    field_type: str
    required: bool
    placeholder: str | None = None
    options: list[AutomationConditionFieldOptionResponse]


class AutomationActionResponse(BaseModel):
    key: str
    category: str
    label: str
    description: str
    module_keys: list[str]
    fields: list[AutomationActionFieldResponse]


class AutomationActionRegistryResponse(BaseModel):
    results: list[AutomationActionResponse]


class RecordCommentResponse(BaseModel):
    id: int
    actor_user_id: int | None = None
    module_key: str
    entity_id: str
    body: str
    author_name: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RecordCommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    mentioned_user_ids: list[int] = Field(default_factory=list)


class RecordCommentListResponse(BaseModel):
    results: list[RecordCommentResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class RecordMentionableUserResponse(BaseModel):
    id: int
    label: str
    email: str


class RecordMentionableUserListResponse(BaseModel):
    results: list[RecordMentionableUserResponse]


class LinkedRecordUserResponse(BaseModel):
    id: int
    label: str
    email: str


class LinkedRecordUserListResponse(BaseModel):
    results: list[LinkedRecordUserResponse]


class GlobalSearchResultResponse(BaseModel):
    module_key: str
    module_label: str
    record_id: str
    title: str
    subtitle: str | None = None
    href: str


class GlobalSearchResponse(BaseModel):
    query: str
    results: list[GlobalSearchResultResponse]


class MessageTemplateResponse(BaseModel):
    id: int
    template_key: str
    name: str
    description: str | None = None
    channel: str
    module_key: str | None = None
    body: str
    variables: list[str]
    is_system: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class MessageTemplateCreateRequest(BaseModel):
    template_key: str | None = None
    name: str = Field(min_length=1, max_length=180)
    description: str | None = None
    channel: str = Field(min_length=1, max_length=40)
    module_key: str | None = Field(default=None, max_length=100)
    body: str = Field(min_length=1)
    variables: list[str] = Field(default_factory=list)
    is_active: bool = True


class MessageTemplateUpdateRequest(BaseModel):
    template_key: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = None
    channel: str | None = Field(default=None, min_length=1, max_length=40)
    module_key: str | None = Field(default=None, max_length=100)
    body: str | None = Field(default=None, min_length=1)
    variables: list[str] | None = None
    is_active: bool | None = None


class MessageTemplateListResponse(BaseModel):
    results: list[MessageTemplateResponse]


class IntegrationProviderResponse(BaseModel):
    id: int
    key: str
    name: str
    category: str
    description: str | None = None
    enabled: bool
    metadata_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class IntegrationProviderListResponse(BaseModel):
    results: list[IntegrationProviderResponse]


class IntegrationConnectionResponse(BaseModel):
    id: int | None = None
    provider_key: str
    status: str
    connected_by_id: int | None = None
    connected_at: datetime | None = None
    last_sync_at: datetime | None = None
    settings_json: dict[str, Any] = Field(default_factory=dict)
    source: str = "registry"
    connection_count: int = 0
    last_error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class IntegrationConnectionListResponse(BaseModel):
    results: list[IntegrationConnectionResponse]


class IntegrationHealthResponse(BaseModel):
    provider: IntegrationProviderResponse
    connection: IntegrationConnectionResponse


class IntegrationHealthListResponse(BaseModel):
    results: list[IntegrationHealthResponse]


class IntegrationSyncRunResponse(BaseModel):
    id: int
    connection_id: int
    provider_key: str
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    result_json: dict[str, Any]
    error_message: str | None = None


class IntegrationSyncRunListResponse(BaseModel):
    results: list[IntegrationSyncRunResponse]
