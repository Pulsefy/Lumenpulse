# Lightweight per-stage profiler helper
import time
import tracemalloc
import resource
from typing import Callable, Any, Dict
from contextlib import contextmanager

from .metrics import (
    PIPELINE_STAGE_WALL_SECONDS,
    PIPELINE_STAGE_CPU_SECONDS,
    PIPELINE_STAGE_PEAK_MEMORY_BYTES,
)


class StageProfile:
    def __init__(self, stage: str):
        self.stage = stage
        self.wall_seconds = 0.0
        self.cpu_seconds = 0.0
        self.peak_memory = 0


@contextmanager
def profile_stage(stage: str):
    """Context manager that measures wall time, CPU time and peak memory for a stage.

    Yields a dict-like `StageProfile` instance with measured values.
    """
    # Start measurements
    start_wall = time.perf_counter()
    start_cpu = time.process_time()

    # Start tracemalloc for peak python memory tracking
    try:
        tracemalloc.start()
        using_tracemalloc = True
    except Exception:
        using_tracemalloc = False

    # Also snapshot resource.ru_maxrss on POSIX (bytes on Linux depending on unit)
    try:
        start_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        using_rusage = True
    except Exception:
        start_rss = 0
        using_rusage = False

    profile = StageProfile(stage)
    try:
        yield profile
    finally:
        end_wall = time.perf_counter()
        end_cpu = time.process_time()

        profile.wall_seconds = end_wall - start_wall
        profile.cpu_seconds = end_cpu - start_cpu

        peak_bytes = 0
        if using_tracemalloc:
            try:
                current, peak = tracemalloc.get_traced_memory()
                peak_bytes = peak
            except Exception:
                peak_bytes = 0
            finally:
                tracemalloc.stop()

        if using_rusage:
            try:
                end_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                # On many Linux systems ru_maxrss is in kilobytes
                if end_rss >= start_rss:
                    peak_bytes = max(peak_bytes, (end_rss - start_rss) * 1024)
            except Exception:
                pass

        profile.peak_memory = peak_bytes

        # Export metrics
        try:
            PIPELINE_STAGE_WALL_SECONDS.labels(stage=stage).observe(profile.wall_seconds)
            PIPELINE_STAGE_CPU_SECONDS.labels(stage=stage).observe(profile.cpu_seconds)
            PIPELINE_STAGE_PEAK_MEMORY_BYTES.labels(stage=stage).set(profile.peak_memory)
        except Exception:
            # Never allow metrics failures to break the pipeline
            pass


# Convenience decorator
def profiled(stage: str):
    def decorator(fn: Callable[..., Any]):
        def wrapper(*args, **kwargs):
            with profile_stage(stage):
                return fn(*args, **kwargs)

        return wrapper

    return decorator
