"""One commit per business action (13-final-fixes.md FQ.1, 13a E5).

Services flush; the route, job or automation run that owns the business action commits once.
Most services already work that way. The older ones still call `db.commit()` themselves, so a
composite flow (convert a lead, turn a quote into an order) committed three or four times and a
failure halfway left half the records behind. Accounting posting (F7) cannot live with that.

- `unit_of_work(db)` wraps one business action: inside it a `db.commit()` is a flush, and the
  block commits once at the end, or rolls everything back if anything raised. Blocks nest; the
  outermost one commits.
- `deferred_commits(db)` is the first half alone, for a caller that commits or rolls back
  itself (an automation run decides per rule).
- `on_commit(db, fn)` runs `fn` after the session's next real commit and drops it on rollback.
  Work that must not run for a transaction that never lands goes here: queueing Celery tasks,
  waking other processes. The session is between transactions when `fn` runs, so `fn` must
  not use it; open a new session if it needs the database (`on_commit_session`).

The commit hooks are registered when `app.core.database` is imported, like the realtime ones
(`app/core/realtime_hooks.py`), so they exist before any session commits.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
import logging

from sqlalchemy import event
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_DEPTH_KEY = "lynk_deferred_commit_depth"
_CALLBACKS_KEY = "lynk_on_commit_callbacks"


def in_unit_of_work(db: Session) -> bool:
    """True while `db.commit()` is deferred to an enclosing business action."""
    info = getattr(db, "info", None)
    return isinstance(info, dict) and bool(info.get(_DEPTH_KEY))


@contextmanager
def deferred_commits(db: Session) -> Iterator[Session]:
    """Inside the block a `db.commit()` only flushes; the caller commits or rolls back."""
    depth = db.info.get(_DEPTH_KEY, 0)
    db.info[_DEPTH_KEY] = depth + 1
    if depth == 0:
        # An instance attribute shadows `Session.commit` for this session only, which works
        # for any session (tests build their own) and is undone exactly once, below.
        db.commit = db.flush  # type: ignore[method-assign]
    try:
        yield db
    finally:
        db.info[_DEPTH_KEY] = depth
        if depth == 0:
            db.info.pop(_DEPTH_KEY, None)
            db.__dict__.pop("commit", None)


@contextmanager
def unit_of_work(db: Session) -> Iterator[Session]:
    """One business action, one commit. Nested blocks join the outermost one."""
    if in_unit_of_work(db):
        with deferred_commits(db):
            yield db
        return
    try:
        with deferred_commits(db):
            yield db
    except BaseException:
        # Dropped here as well as by the rollback hook: a block that failed before any SQL ran
        # has no database transaction, so the rollback never reaches the database.
        db.info.pop(_CALLBACKS_KEY, None)
        db.rollback()
        raise
    db.commit()


@contextmanager
def savepoint(db: Session) -> Iterator[Session]:
    """A nested transaction. If it rolls back, so do the `on_commit` callbacks made inside it."""
    pending = len(db.info.get(_CALLBACKS_KEY, []))
    nested = db.begin_nested()
    try:
        yield db
    except BaseException:
        if nested.is_active:
            nested.rollback()
        del db.info.get(_CALLBACKS_KEY, [])[pending:]
        raise
    if nested.is_active:
        nested.commit()


def on_commit(db: Session, callback: Callable[[], None]) -> None:
    """Run `callback` after the next real commit of `db`; forget it on rollback."""
    db.info.setdefault(_CALLBACKS_KEY, []).append(callback)


def on_commit_session(db: Session) -> Session:
    """A fresh session on `db`'s connection pool, for an `on_commit` callback that writes."""
    return Session(bind=db.get_bind())


@event.listens_for(Session, "after_commit")
def _run_on_commit_callbacks(session: Session) -> None:
    for callback in session.info.pop(_CALLBACKS_KEY, []):
        try:
            callback()
        except Exception:
            # The transaction has landed; a failed side effect is logged, never raised into
            # a request that already succeeded.
            logger.exception("on_commit callback failed")


@event.listens_for(Session, "after_soft_rollback")
def _discard_on_commit_callbacks(session: Session, previous_transaction) -> None:
    # Every rollback of the outermost transaction, including one with nothing to roll back in
    # the database (`after_rollback` only fires on a real one). A savepoint's rollback drops
    # only its own callbacks, in `savepoint`.
    if previous_transaction.parent is None:
        session.info.pop(_CALLBACKS_KEY, None)
