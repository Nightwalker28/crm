from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

from app.core.config import settings


PBKDF2_ALGORITHM = "sha256"
PBKDF2_ITERATIONS = settings.PBKDF2_ITERATIONS
SALT_BYTES = 16
MIN_PASSWORD_LENGTH = settings.PASSWORD_MIN_LENGTH
PASSWORD_REQUIREMENTS = (
    "Use at least {min_length} characters.",
    "Use at least one uppercase letter, one lowercase letter, and one number.",
    "Avoid common or repeated-character passwords.",
)
COMMON_PASSWORDS = {
    "password",
    "password1",
    "password12",
    "password123",
    "password1234",
    "qwerty",
    "qwerty123",
    "adminadmin",
    "admin123",
    "welcome123",
    "letmein123",
    "changeme",
    "change123",
    "company123",
}


def get_password_policy() -> dict:
    return {
        "min_length": MIN_PASSWORD_LENGTH,
        "requirements": [
            requirement.format(min_length=MIN_PASSWORD_LENGTH)
            for requirement in PASSWORD_REQUIREMENTS
        ],
    }


def validate_password_strength(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters long")
    normalized = password.strip().lower()
    if normalized in COMMON_PASSWORDS:
        raise ValueError("Password is too common")
    if len(set(password)) == 1:
        raise ValueError("Password cannot use the same character repeatedly")
    if not any(char.islower() for char in password):
        raise ValueError("Password must include at least one lowercase letter")
    if not any(char.isupper() for char in password):
        raise ValueError("Password must include at least one uppercase letter")
    if not any(char.isdigit() for char in password):
        raise ValueError("Password must include at least one number")


def hash_password(password: str) -> str:
    validate_password_strength(password)
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        PBKDF2_ALGORITHM,
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    salt_b64 = base64.b64encode(salt).decode("ascii")
    digest_b64 = base64.b64encode(digest).decode("ascii")
    return f"pbkdf2_{PBKDF2_ALGORITHM}${PBKDF2_ITERATIONS}${salt_b64}${digest_b64}"


def password_hash_needs_upgrade(stored_hash: str | None) -> bool:
    if not stored_hash:
        return False

    try:
        scheme, iterations_raw, _, _ = stored_hash.split("$", 3)
        iterations = int(iterations_raw)
    except (ValueError, TypeError):
        return False

    return scheme == f"pbkdf2_{PBKDF2_ALGORITHM}" and iterations < PBKDF2_ITERATIONS


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False

    try:
        scheme, iterations_raw, salt_b64, expected_b64 = stored_hash.split("$", 3)
    except ValueError:
        return False

    if scheme != f"pbkdf2_{PBKDF2_ALGORITHM}":
        return False

    try:
        iterations = int(iterations_raw)
        salt = base64.b64decode(salt_b64.encode("ascii"))
        expected = base64.b64decode(expected_b64.encode("ascii"))
    except (ValueError, TypeError):
        return False

    candidate = hashlib.pbkdf2_hmac(
        PBKDF2_ALGORITHM,
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(candidate, expected)
