"""
Tests for cache invalidation on model promotion (#1251).

A promoted model must never serve inference results produced by the previous
model version, so ``promote_model`` evicts the whole cache namespace for the
model type.
"""

import cache_manager as cm_module
import src.ml.model_registry as model_registry


def test_invalidate_cached_inference_clears_namespace(monkeypatch):
    cleared = []

    class FakeCacheManager:
        def __init__(self, namespace="cache"):
            self.namespace = namespace

        def clear_namespace(self):
            cleared.append(self.namespace)
            return 3

    monkeypatch.setattr(cm_module, "CacheManager", FakeCacheManager)

    model_registry._invalidate_cached_inference("sentiment")
    assert cleared == ["sentiment"]


def test_invalidate_cached_inference_swallows_redis_errors(monkeypatch):
    class BrokenCacheManager:
        def __init__(self, namespace="cache"):
            raise ConnectionError("redis unavailable")

    monkeypatch.setattr(cm_module, "CacheManager", BrokenCacheManager)

    # Must not raise.
    model_registry._invalidate_cached_inference("sentiment")


def test_promote_model_invalidates_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(model_registry, "_MODELS_ROOT", tmp_path)
    cleared = []

    class FakeCacheManager:
        def __init__(self, namespace="cache"):
            self.namespace = namespace

        def clear_namespace(self):
            cleared.append(self.namespace)
            return 1

    monkeypatch.setattr(cm_module, "CacheManager", FakeCacheManager)

    version = model_registry.save_model("sentiment", {"lexicon": {"moon": 4.0}})
    model_registry.promote_model("sentiment", version)

    assert cleared == ["sentiment"]
