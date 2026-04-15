import os
from dotenv import load_dotenv

load_dotenv()


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

    # Added for finance team IO automation
    GOOGLE_TOKEN_ENCRYPTION_KEY: str = os.getenv("GOOGLE_TOKEN_ENCRYPTION_KEY")
    GOOGLE_DOCS_TEMPLATE_ID: str = os.getenv("GOOGLE_DOCS_TEMPLATE_ID")
    GOOGLE_DRIVE_IO_FOLDER_ID: str = os.getenv("GOOGLE_DRIVE_IO_FOLDER_ID")
    GOOGLE_API_TIMEOUT_SECONDS: int = int(os.getenv("GOOGLE_API_TIMEOUT_SECONDS", "120"))
    GOOGLE_API_MAX_RETRIES: int = int(os.getenv("GOOGLE_API_MAX_RETRIES", "5"))
    GOOGLE_API_RETRY_BASE_DELAY_SECONDS: float = float(
        os.getenv("GOOGLE_API_RETRY_BASE_DELAY_SECONDS", "1.0")
    )
    

    # -------------------------
    # JWT configuration
    # -------------------------
    JWT_SECRET: str = os.getenv("JWT_SECRET", "change-me")
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
    USER_SETUP_TOKEN_EXPIRE_HOURS: int = int(
        os.getenv("USER_SETUP_TOKEN_EXPIRE_HOURS", "72")
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
    COOKIE_SECURE: bool = os.getenv("COOKIE_SECURE", "false").lower() == "true"

    # Lax is correct for same-site frontend/backend
    COOKIE_SAMESITE: str = os.getenv("COOKIE_SAMESITE", "lax")

    COOKIE_PATH: str = os.getenv("COOKIE_PATH", "/")

    DEBUG: bool = os.getenv("DEBUG", "false")

    # -------------------------
    # Frontend
    # -------------------------
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
    REDIS_URL: str | None = os.getenv("REDIS_URL")

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


settings = Settings()
