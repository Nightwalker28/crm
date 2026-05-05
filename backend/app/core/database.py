from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import settings

if not settings.DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be set")

connect_args = {}
if settings.DATABASE_URL and settings.DATABASE_URL.startswith(("postgresql://", "postgresql+")):
    connect_args["options"] = (
        f"-c statement_timeout={settings.DB_STATEMENT_TIMEOUT_MS} "
        f"-c idle_in_transaction_session_timeout={settings.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS}"
    )

engine = create_engine(
    settings.DATABASE_URL,
    future=True,
    echo=False,
    pool_pre_ping=settings.DB_POOL_PRE_PING,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
    connect_args=connect_args,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
