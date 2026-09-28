"""Unit tests for the pinned embedding service (#1455)."""

import json
from types import SimpleNamespace

import pytest

from src.analytics.embedding_service import (
    EmbeddingService,
    MissingEmbeddingModelError,
    article_text,
    check_model_available,
    cosine_similarity,
    hash_article_text,
    normalize_vector,
)
from src.config.embedding_config import EmbeddingConfig

_DEFAULT_MODEL = EmbeddingConfig().model_name
_DEFAULT_VERSION = EmbeddingConfig().model_version


class _Vector(list):
    """Mimic ``numpy.ndarray`` the way spaCy exposes ``doc.vector``."""

    def tolist(self) -> list:
        return list(self)


class _FakeNlp:
    """Stands in for the spaCy pipeline: returns a fixed-length doc vector."""

    def __init__(self) -> None:
        self.seen: list = []

    def __call__(self, text):
        self.seen.append(text)
        return SimpleNamespace(vector=_Vector([3.0, 4.0]))


def _service(with_nlp: bool = True) -> EmbeddingService:
    service = EmbeddingService.__new__(EmbeddingService)
    service._cfg = EmbeddingConfig()
    service._nlp = _FakeNlp() if with_nlp else None
    return service


def test_normalize_vector_unit_length() -> None:
    vector = normalize_vector([3.0, 4.0])
    assert len(vector) == 2
    norm = sum(x * x for x in vector) ** 0.5
    assert norm == pytest.approx(1.0)
    assert vector[0] == pytest.approx(0.6)


def test_normalize_zero_vector_unchanged() -> None:
    assert normalize_vector([0.0, 0.0]) == [0.0, 0.0]


def test_cosine_similarity_identical_is_one() -> None:
    assert cosine_similarity([1.0, 0.0, 0.0], [1.0, 0.0, 0.0]) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_is_zero() -> None:
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_similarity_degenerate_inputs_are_zero() -> None:
    assert cosine_similarity([], [1.0]) == 0.0
    assert cosine_similarity([1.0, 2.0], [1.0]) == 0.0
    assert cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_article_text_joins_present_fields_only() -> None:
    assert article_text(title="Title", summary="Summary") == "Title\nSummary"
    assert article_text(title="  ", summary=None, content="Body") == "Body"
    assert article_text() == ""


def test_hash_article_text_is_deterministic_sha256() -> None:
    first = hash_article_text(title="Stellar", summary="Soroban")
    second = hash_article_text(title="Stellar", summary="Soroban")
    assert first == second
    assert len(first) == 64
    assert all(c in "0123456789abcdef" for c in first)
    assert hash_article_text(title="XLM") != first


def _write_meta(model_dir, name: str) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "meta.json").write_text(json.dumps({"name": name}), encoding="utf-8")


def test_check_model_available_passes_when_pinned_version_present(tmp_path) -> None:
    cfg = EmbeddingConfig(model_dir=str(tmp_path))
    _write_meta(tmp_path, f"{_DEFAULT_MODEL}-{_DEFAULT_VERSION}")
    check_model_available(cfg)


def test_check_model_available_fails_fast_when_missing(tmp_path) -> None:
    cfg = EmbeddingConfig(model_dir=str(tmp_path))
    with pytest.raises(MissingEmbeddingModelError):
        check_model_available(cfg)


def test_check_model_available_fails_fast_on_version_mismatch(tmp_path) -> None:
    cfg = EmbeddingConfig(model_dir=str(tmp_path))
    _write_meta(tmp_path, "en_core_web_md-1.0.0")
    with pytest.raises(MissingEmbeddingModelError):
        check_model_available(cfg)


def test_model_metadata_properties() -> None:
    cfg = EmbeddingConfig(model_name=_DEFAULT_MODEL, model_version=_DEFAULT_VERSION)
    service = _service()
    assert service.model_name == _DEFAULT_MODEL
    assert service.model_version == _DEFAULT_VERSION
    assert service.dimension == 300
    assert cfg.shipped_version_tag == f"{_DEFAULT_MODEL}-{_DEFAULT_VERSION}"


def test_embed_raises_when_model_unavailable() -> None:
    service = _service(with_nlp=False)
    with pytest.raises(MissingEmbeddingModelError):
        service.embed("Stellar Soroban news")


def test_embed_returns_unit_vector_from_pipeline() -> None:
    service = _service()
    vector = service.embed("Stellar Soroban news")
    assert vector == pytest.approx([0.6, 0.8])
    # The pipeline is passed the truncated input once.
    assert service._nlp.seen == ["Stellar Soroban news"]


def test_embed_returns_zero_vector_for_blank_text() -> None:
    service = _service()
    vector = service.embed("   ")
    assert vector == [0.0] * 300


def test_embed_article_concatenates_fields() -> None:
    service = _service()
    service.embed_article(title="Title", summary="Summary", content="Body")
    assert service._nlp.seen == ["Title\nSummary\nBody"]


def test_embed_article_empty_fields_are_zero_vector() -> None:
    service = _service()
    assert service.embed_article() == [0.0] * 300
