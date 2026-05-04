import os
from dotenv import load_dotenv

load_dotenv()


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int_list(name: str, default: list[int]) -> list[int]:
    raw_value = os.getenv(name)
    if not raw_value:
        return default
    values: list[int] = []
    for item in raw_value.split(","):
        stripped = item.strip()
        if not stripped:
            continue
        values.append(int(stripped))
    return values or default


class Settings:
    # -------------------------
    # Database
    # -------------------------
    DATABASE_URL: str = os.getenv("DATABASE_URL")
    DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "10"))
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "20"))
    DB_POOL_RECYCLE_SECONDS: int = int(os.getenv("DB_POOL_RECYCLE_SECONDS", "1800"))

    # -------------------------
    # Google OAuth
    # -------------------------
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET")
    GOOGLE_REDIRECT_URI: str = os.getenv("GOOGLE_REDIRECT_URI")
    MICROSOFT_CLIENT_ID: str | None = os.getenv("MICROSOFT_CLIENT_ID")
    MICROSOFT_CLIENT_SECRET: str | None = os.getenv("MICROSOFT_CLIENT_SECRET")
    MICROSOFT_REDIRECT_URI: str | None = os.getenv("MICROSOFT_REDIRECT_URI")
    GOOGLE_GMAIL_RESTRICTED_SYNC_ENABLED: bool = os.getenv("GOOGLE_GMAIL_RESTRICTED_SYNC_ENABLED", "false").lower() == "true"
    MAIL_CREDENTIAL_SECRET: str = os.getenv("MAIL_CREDENTIAL_SECRET", "").strip()

    # -------------------------
    # JWT configuration
    # -------------------------
    JWT_SECRET: str = os.getenv("JWT_SECRET", "").strip()
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")

    # -------------------------
    # Token lifetimes
    # -------------------------
    # Short lived access token
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60")
    )

    # Hard session limit (Changed to minutes for testing/granularity)
    REFRESH_TOKEN_EXPIRE_HOURS: int = int(
        os.getenv("REFRESH_TOKEN_EXPIRE_HOURS", "8")
    )
    REFRESH_TOKEN_REISSUE_MIN_SECONDS: int = int(
        os.getenv("REFRESH_TOKEN_REISSUE_MIN_SECONDS", "30")
    )
    USER_SETUP_TOKEN_EXPIRE_HOURS: int = int(
        os.getenv("USER_SETUP_TOKEN_EXPIRE_HOURS", "72")
    )
    USER_SETUP_TOKEN_RETENTION_DAYS: int = int(
        os.getenv("USER_SETUP_TOKEN_RETENTION_DAYS", "30")
    )

    # -------------------------
    # Cookie configuration
    # -------------------------
    ACCESS_TOKEN_COOKIE_NAME: str = os.getenv(
        "ACCESS_TOKEN_COOKIE_NAME", "lynk_access_token"
    )
    REFRESH_TOKEN_COOKIE_NAME: str = os.getenv(
        "REFRESH_TOKEN_COOKIE_NAME", "lynk_refresh_token"
    )

    COOKIE_HTTPONLY: bool = True

    # Must be False for local http, True for https in production
    COOKIE_SECURE: bool = _env_bool("COOKIE_SECURE")

    # Lax is correct for same-site frontend/backend
    COOKIE_SAMESITE: str = os.getenv("COOKIE_SAMESITE", "lax")

    COOKIE_PATH: str = os.getenv("COOKIE_PATH", "/")

    DEBUG: bool = _env_bool("DEBUG")

    # -------------------------
    # Deployment / cloud licensing
    # -------------------------
    DEPLOYMENT_LICENSE: str | None = os.getenv("DEPLOYMENT_LICENSE")
    DEPLOYMENT_LICENSE_PUBLIC_KEY: str | None = os.getenv("DEPLOYMENT_LICENSE_PUBLIC_KEY")
    DEPLOYMENT_LICENSE_ALGORITHM: str = os.getenv("DEPLOYMENT_LICENSE_ALGORITHM", "RS256")
    SINGLE_TENANT_SLUG: str = os.getenv("SINGLE_TENANT_SLUG", "default")
    SINGLE_TENANT_NAME: str = os.getenv("SINGLE_TENANT_NAME", "Default Tenant")
    GOOGLE_OAUTH_STATE_EXPIRE_MINUTES: int = int(
        os.getenv("GOOGLE_OAUTH_STATE_EXPIRE_MINUTES", "10")
    )

    # -------------------------
    # Frontend
    # -------------------------
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
    REDIS_URL: str | None = os.getenv("REDIS_URL")
    CELERY_BROKER_URL: str | None = os.getenv("CELERY_BROKER_URL") or os.getenv("REDIS_URL")
    DATA_TRANSFER_BACKGROUND_ROW_THRESHOLD: int = int(
        os.getenv("DATA_TRANSFER_BACKGROUND_ROW_THRESHOLD", "10000")
    )
    DATA_TRANSFER_BACKGROUND_FILE_BYTES_THRESHOLD: int = int(
        os.getenv("DATA_TRANSFER_BACKGROUND_FILE_BYTES_THRESHOLD", str(5 * 1024 * 1024))
    )
    DATA_TRANSFER_RESULT_RETENTION_DAYS: int = int(
        os.getenv("DATA_TRANSFER_RESULT_RETENTION_DAYS", "7")
    )
    DATA_TRANSFER_RESULT_CLEANUP_INTERVAL_SECONDS: int = int(
        os.getenv("DATA_TRANSFER_RESULT_CLEANUP_INTERVAL_SECONDS", str(24 * 60 * 60))
    )
    TASK_DUE_ALERT_SCAN_INTERVAL_SECONDS: int = int(
        os.getenv("TASK_DUE_ALERT_SCAN_INTERVAL_SECONDS", str(60 * 60))
    )
    FOLLOW_UP_REMINDER_SCAN_INTERVAL_SECONDS: int = int(
        os.getenv("FOLLOW_UP_REMINDER_SCAN_INTERVAL_SECONDS", str(24 * 60 * 60))
    )
    NO_REPLY_REMINDER_DAYS: int = int(os.getenv("NO_REPLY_REMINDER_DAYS", "3"))
    INACTIVE_DEAL_REMINDER_DAYS: int = int(os.getenv("INACTIVE_DEAL_REMINDER_DAYS", "14"))
    CLIENT_ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("CLIENT_ACCESS_TOKEN_EXPIRE_MINUTES", "120")
    )
    PAGINATION_DEFAULT_PAGE_SIZE: int = int(os.getenv("PAGINATION_DEFAULT_PAGE_SIZE", "10"))
    PAGINATION_PAGE_SIZE_OPTIONS: list[int] = _env_int_list(
        "PAGINATION_PAGE_SIZE_OPTIONS",
        [10, 25, 50],
    )
    PAGINATION_MAX_PUBLIC_PAGE_SIZE: int = int(os.getenv("PAGINATION_MAX_PUBLIC_PAGE_SIZE", "100"))
    POSTGRES_TRIGRAM_SIMILARITY_THRESHOLD: float = float(
        os.getenv("POSTGRES_TRIGRAM_SIMILARITY_THRESHOLD", "0.3")
    )
    POSTGRES_TRIGRAM_MIN_SEARCH_LENGTH: int = int(
        os.getenv("POSTGRES_TRIGRAM_MIN_SEARCH_LENGTH", "3")
    )

    # -------------------------
    # Allowed email domains
    # -------------------------
    ALLOWED_DOMAINS: list[str] = [
        d.strip().lower()
        for d in os.getenv("ALLOWED_DOMAINS", "").split(",")
        if d.strip()
    ]

    # -------------------------
    # Initial bootstrap admin
    # -------------------------
    INITIAL_ADMIN_EMAIL: str | None = os.getenv("INITIAL_ADMIN_EMAIL")
    INITIAL_ADMIN_PASSWORD: str | None = os.getenv("INITIAL_ADMIN_PASSWORD")
    INITIAL_ADMIN_FIRST_NAME: str = os.getenv("INITIAL_ADMIN_FIRST_NAME", "System")
    INITIAL_ADMIN_LAST_NAME: str = os.getenv("INITIAL_ADMIN_LAST_NAME", "Admin")
    PASSWORD_MIN_LENGTH: int = int(os.getenv("PASSWORD_MIN_LENGTH", "12"))
    PBKDF2_ITERATIONS: int = int(os.getenv("PBKDF2_ITERATIONS", "310000"))
    DOCUMENT_MAX_UPLOAD_BYTES: int = int(os.getenv("DOCUMENT_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
    DOCUMENT_TENANT_STORAGE_LIMIT_BYTES: int = int(
        os.getenv("DOCUMENT_TENANT_STORAGE_LIMIT_BYTES", str(250 * 1024 * 1024))
    )


settings = Settings()


def validate_startup_settings() -> None:
    if not settings.DEBUG and not settings.JWT_SECRET:
        raise RuntimeError("JWT_SECRET must be set when DEBUG is false")
