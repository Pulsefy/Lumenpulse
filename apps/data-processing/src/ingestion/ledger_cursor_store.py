"""
Persistent Ledger Cursor Store
==============================
Provides a durable, database-backed cursor that tracks the last safely
ingested ledger sequence per stream (contract or global ingestion key).

Design goals
------------
* **Survives restarts** — state lives in PostgreSQL, not in process memory or
  flat files.
* **Atomic advance** — each ``advance`` call uses a serialisable UPDATE with an
  optimistic check so no two workers can accidentally regress a cursor.
* **Safe-point rollback** — callers can obtain a *safe ledger* value before
  processing a batch and roll back to it if the batch fails, preventing a
  half-committed window from being silently skipped.
* **Duplicate guard** — the store tracks the last ingested *event_id* inside
  the cursor row so callers can detect events they have already seen without
  hitting the main event table.
* **Visibility** — ``list_cursors`` returns the full cursor inventory for
  health dashboards and runbooks.

Usage
-----
::

    store = LedgerCursorStore(db_url="postgresql://...")

    # Get or create a cursor for a specific stream
    cursor = store.get_or_create("contract:CXXX...YYY")

    # Begin a new batch: saves a safe-point at the current ledger
    safe_ledger = store.begin_batch("contract:CXXX...YYY", cursor.last_ingested_ledger)

    try:
        # ... ingest events for ledgers (safe_ledger, next_batch_end] ...
        store.advance(
            stream_id="contract:CXXX...YYY",
            new_ledger=next_batch_end,
            last_event_id="<id of last event processed>",
        )
    except Exception:
        store.rollback_to_safe_point("contract:CXXX...YYY")
        raise

    # For operational status
    cursors = store.list_cursors()
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Generator, List, Optional

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Integer,
    String,
    create_engine,
    func,
    text,
)
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, declarative_base, sessionmaker

logger = logging.getLogger(__name__)

_Base = declarative_base()

# ---------------------------------------------------------------------------
# ORM model
# ---------------------------------------------------------------------------


class LedgerCursorRow(_Base):
    """
    One row per *stream_id*.  A stream can be:
    * ``"global"`` — the whole-network live ingestion pipeline
    * ``"contract:<contract_id>"`` — per-contract event stream
    * any other arbitrary key the caller chooses

    Columns
    -------
    stream_id
        Unique identifier for the ingestion stream.
    last_ingested_ledger
        The ledger sequence that has been fully processed and committed.
        Recovery should resume from ``last_ingested_ledger + 1``.
    safe_ledger
        The ledger at which the last batch *started*.  On failure the
        coordinator rolls back to this value so the partial batch is retried.
    last_event_id
        The event-level idempotency key of the last event processed in the
        stream.  Used as a quick duplicate check before hitting the events
        table.
    status
        ``"idle"`` | ``"ingesting"`` | ``"failed"``
    error_message
        Last error detail when ``status == "failed"``.
    updated_at
        Server-side timestamp updated on every write.
    created_at
        Row creation timestamp.
    """

    __tablename__ = "ledger_cursors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    stream_id = Column(String(512), nullable=False, unique=True, index=True)
    last_ingested_ledger = Column(BigInteger, nullable=False, default=0)
    safe_ledger = Column(BigInteger, nullable=False, default=0)
    last_event_id = Column(String(512), nullable=True)
    status = Column(String(32), nullable=False, default="idle")
    error_message = Column(String(2048), nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def to_dict(self) -> dict:
        return {
            "stream_id": self.stream_id,
            "last_ingested_ledger": self.last_ingested_ledger,
            "safe_ledger": self.safe_ledger,
            "last_event_id": self.last_event_id,
            "status": self.status,
            "error_message": self.error_message,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


class LedgerCursorStore:
    """
    Thread-safe, database-backed ledger cursor store.

    Parameters
    ----------
    db_url:
        SQLAlchemy database URL.  Defaults to the ``DATABASE_URL`` environment
        variable.  SQLite is accepted for tests.
    auto_create_table:
        Create the ``ledger_cursors`` table if it does not exist.  In
        production you should run the Alembic migration instead; set this to
        ``False`` to enforce that.
    """

    def __init__(
        self,
        db_url: Optional[str] = None,
        *,
        auto_create_table: bool = True,
    ) -> None:
        resolved_url = db_url or os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@localhost:5432/lumenpulse",
        )

        connect_args: dict = {}
        pool_kwargs: dict = {}

        if resolved_url.startswith("sqlite"):
            from sqlalchemy.pool import StaticPool

            connect_args = {"check_same_thread": False}
            pool_kwargs = {"poolclass": StaticPool}
        else:
            pool_kwargs = {"pool_pre_ping": True, "pool_size": 3, "max_overflow": 5}

        self._engine = create_engine(resolved_url, echo=False, **pool_kwargs, connect_args=connect_args)
        self._Session = sessionmaker(
            bind=self._engine,
            autocommit=False,
            autoflush=False,
            expire_on_commit=False,
        )

        if auto_create_table:
            _Base.metadata.create_all(self._engine, tables=[LedgerCursorRow.__table__])

        logger.info("LedgerCursorStore initialised (url=%s)", resolved_url.split("@")[-1])

    # ------------------------------------------------------------------
    # Context manager helper
    # ------------------------------------------------------------------

    @contextmanager
    def _session(self) -> Generator[Session, None, None]:
        session: Session = self._Session()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_or_create(self, stream_id: str) -> LedgerCursorRow:
        """
        Return the cursor row for *stream_id*, creating it at ledger 0 if
        it does not exist.

        This is safe to call concurrently: a unique constraint on
        ``stream_id`` prevents duplicate rows.
        """
        with self._session() as session:
            row = session.query(LedgerCursorRow).filter_by(stream_id=stream_id).first()
            if row is None:
                row = LedgerCursorRow(
                    stream_id=stream_id,
                    last_ingested_ledger=0,
                    safe_ledger=0,
                    status="idle",
                )
                session.add(row)
                try:
                    session.flush()
                except IntegrityError:
                    # Another process beat us to it; load what's there.
                    session.rollback()
                    row = (
                        session.query(LedgerCursorRow)
                        .filter_by(stream_id=stream_id)
                        .one()
                    )
                logger.info("Created new ledger cursor for stream=%s", stream_id)
            return row

    def begin_batch(self, stream_id: str, current_ledger: int) -> int:
        """
        Mark the start of a new ingestion batch for *stream_id*.

        Saves *current_ledger* as the ``safe_ledger`` (the point we will roll
        back to on failure) and transitions ``status`` to ``"ingesting"``.

        Returns the safe ledger value for the caller's reference.
        """
        with self._session() as session:
            row = (
                session.query(LedgerCursorRow)
                .filter_by(stream_id=stream_id)
                .with_for_update()
                .first()
            )
            if row is None:
                raise ValueError(
                    f"No cursor found for stream_id={stream_id!r}. "
                    "Call get_or_create() first."
                )
            row.safe_ledger = current_ledger
            row.status = "ingesting"
            row.error_message = None
            logger.debug(
                "begin_batch stream=%s safe_ledger=%d", stream_id, current_ledger
            )
            return current_ledger

    def advance(
        self,
        stream_id: str,
        new_ledger: int,
        last_event_id: Optional[str] = None,
    ) -> None:
        """
        Commit progress: set ``last_ingested_ledger`` to *new_ledger* and
        transition status back to ``"idle"``.

        The update is guarded by an optimistic check: it will only succeed if
        the row's ``last_ingested_ledger`` has not been advanced past
        *new_ledger* by another process, preventing accidental regression.

        Raises
        ------
        ValueError
            If *new_ledger* would regress the cursor (new < current).
        RuntimeError
            If no row matched the stream_id.
        """
        with self._session() as session:
            row = (
                session.query(LedgerCursorRow)
                .filter_by(stream_id=stream_id)
                .with_for_update()
                .first()
            )
            if row is None:
                raise RuntimeError(
                    f"Cannot advance: cursor not found for stream_id={stream_id!r}"
                )
            if new_ledger < row.last_ingested_ledger:
                raise ValueError(
                    f"Refusing to regress cursor for stream={stream_id!r}: "
                    f"current={row.last_ingested_ledger}, attempted={new_ledger}"
                )
            row.last_ingested_ledger = new_ledger
            row.safe_ledger = new_ledger
            row.status = "idle"
            row.error_message = None
            if last_event_id is not None:
                row.last_event_id = last_event_id
            logger.info(
                "Cursor advanced stream=%s ledger=%d last_event_id=%s",
                stream_id,
                new_ledger,
                last_event_id,
            )

    def rollback_to_safe_point(
        self, stream_id: str, error_message: Optional[str] = None
    ) -> int:
        """
        Roll the cursor back to its ``safe_ledger`` and mark it as
        ``"failed"``.

        Returns the safe ledger value so the caller can log/report it.
        """
        with self._session() as session:
            row = (
                session.query(LedgerCursorRow)
                .filter_by(stream_id=stream_id)
                .with_for_update()
                .first()
            )
            if row is None:
                raise RuntimeError(
                    f"Cannot rollback: cursor not found for stream_id={stream_id!r}"
                )
            row.last_ingested_ledger = row.safe_ledger
            row.status = "failed"
            row.error_message = (error_message or "")[:2048]
            logger.warning(
                "Cursor rolled back stream=%s to safe_ledger=%d error=%s",
                stream_id,
                row.safe_ledger,
                error_message,
            )
            return row.safe_ledger

    def mark_idle(self, stream_id: str) -> None:
        """Clear a ``failed`` status and return the cursor to ``idle``."""
        with self._session() as session:
            row = (
                session.query(LedgerCursorRow)
                .filter_by(stream_id=stream_id)
                .with_for_update()
                .first()
            )
            if row is None:
                raise RuntimeError(
                    f"Cannot mark idle: cursor not found for stream_id={stream_id!r}"
                )
            row.status = "idle"
            row.error_message = None

    def is_duplicate(self, stream_id: str, event_id: str) -> bool:
        """
        Quick duplicate check: returns ``True`` if *event_id* matches the
        ``last_event_id`` stored in the cursor row.

        Note: this only checks the *last* event.  For full deduplication use
        the unique index on ``raw_soroban_events(contract_id, event_id)``.
        """
        with self._session() as session:
            row = session.query(LedgerCursorRow).filter_by(stream_id=stream_id).first()
            if row is None:
                return False
            return row.last_event_id == event_id

    def list_cursors(self) -> List[dict]:
        """
        Return all cursor rows as a list of plain dicts, suitable for
        operational dashboards and health endpoints.
        """
        with self._session() as session:
            rows = session.query(LedgerCursorRow).order_by(LedgerCursorRow.stream_id).all()
            return [r.to_dict() for r in rows]

    def get_cursor(self, stream_id: str) -> Optional[dict]:
        """Return a single cursor dict or ``None`` if it does not exist."""
        with self._session() as session:
            row = session.query(LedgerCursorRow).filter_by(stream_id=stream_id).first()
            return row.to_dict() if row else None
