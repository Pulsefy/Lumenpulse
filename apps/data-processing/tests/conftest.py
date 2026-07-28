"""
Pytest configuration and shared fixtures for LumenPulse data processing tests.
"""

import os

# Skip FinBERT download/load in default test runs (CI and local pytest).
os.environ.setdefault("SENTIMENT_DISABLE_TRANSFORMER", "1")

import pytest
import sys
import os
import types
import importlib.util
from types import ModuleType
from unittest.mock import MagicMock

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


@pytest.fixture
def sample_data():
    """Fixture providing sample test data."""
    return {"project_id": 1, "name": "Test Project", "amount": 1000}



_HEAVY_MODULES = [
    "stellar_sdk",
    "stellar_sdk.exceptions",
    "stellar_sdk.call_builder",
    "stellar_sdk.call_builder.call_builder_async",
    # Translation / NLP deps not installed in the lightweight test env
    "langdetect",
    # Database / ORM deps not available in the lightweight test env
    "sqlalchemy",
    "sqlalchemy.orm",
    "sqlalchemy.orm.session",
    "sqlalchemy.exc",
    "sqlalchemy.engine",
    "sqlalchemy.engine.url",
    "sqlalchemy.dialects",
    "sqlalchemy.dialects.postgresql",
    "sqlalchemy.sql",
    "sqlalchemy.sql.expression",
    "alembic",
    "alembic.op",
    "psycopg2",
    "asyncpg",
    # HTTP / networking deps not in lightweight env
    "requests",
    "requests.exceptions",
    "redis",
    # Mock heavy/compiled scientific and validation libs to keep tests lightweight
    "numpy",
    "pandas",
    "pydantic",
    "pydantic_core",
    "sklearn",
]
def _ensure_stub_module(mod_name: str):
    # Ensure parent packages exist and create plain ModuleType stubs
    parts = mod_name.split('.')
    for i in range(1, len(parts) + 1):
        sub = '.'.join(parts[:i])
        if sub not in sys.modules:
            sys.modules[sub] = ModuleType(sub)


# Create robust stubs for heavy modules to prevent importing compiled
# extensions and to provide minimal APIs expected by the tests.
for _mod in _HEAVY_MODULES:
    # If the real module is available in the environment, skip stubbing it.
    try:
        if importlib.util.find_spec(_mod) is not None:
            continue
    except Exception:
        pass
    # Ensure parent packages exist
    try:
        _ensure_stub_module(_mod)
    except Exception:
        pass
    # Create a fresh stub module and override any installed package
    m = ModuleType(_mod)
    sys.modules[_mod] = m
    # Ensure parent packages for dotted modules
    parts = _mod.split('.')
    for i in range(1, len(parts)):
        parent = '.'.join(parts[:i])
        if parent not in sys.modules:
            sys.modules[parent] = ModuleType(parent)

    # requests: provide Session and Response
    if _mod == 'requests':
        class Session:
            def __init__(self, *a, **k):
                pass
            def request(self, *a, **k):
                return None
        m.Session = Session
        class Response:
            def __init__(self, status_code=200, text=''):
                self.status_code = status_code
                self.text = text
        m.Response = Response
        ex_mod = ModuleType('requests.exceptions')
        ex_mod.RequestException = Exception
        sys.modules['requests.exceptions'] = ex_mod

    # pandas: Series/DataFrame minimal
    if _mod == 'pandas':
        class Series(list):
            def __init__(self, *a, **k):
                list.__init__(self, *a)
        class DataFrame(list):
            def __init__(self, *a, **k):
                list.__init__(self, *a)
        m.Series = Series
        m.DataFrame = DataFrame
        m.read_csv = lambda *a, **k: DataFrame()

    # numpy: minimal array helpers
    if _mod == 'numpy':
        m.array = lambda x, *a, **k: list(x) if x is not None else []
        m.asarray = m.array
        m.zeros = lambda shape, *a, **k: [0] * (shape if isinstance(shape, int) else 1)

    # pydantic: BaseModel shim and helpers
    if _mod == 'pydantic':
        class BaseModel:
            def __init__(self, **data):
                for k, v in data.items():
                    setattr(self, k, v)
        m.BaseModel = BaseModel
        class ValidationError(Exception):
            pass
        m.ValidationError = ValidationError
        def create_model(name, **fields):
            return type(name, (BaseModel,), {})
        def validator(*args, **kwargs):
            def _decorator(f):
                return f
            return _decorator
        m.create_model = create_model
        m.validator = validator
        # Make `pydantic` behave like a package so submodule imports succeed
        try:
            m.__path__ = []
            pm = ModuleType('pydantic.main')
            pm.IncEx = Exception
            pm.BaseModel = BaseModel
            sys.modules['pydantic.main'] = pm
        except Exception:
            pass

    # pydantic_core: simple stub
    if _mod == 'pydantic_core':
        pass

    # sqlalchemy: provide basic symbols and sqlalchemy.orm.sessionmaker
    if _mod == 'sqlalchemy':
        m.create_engine = lambda *a, **k: None
        m.select = lambda *a, **k: None
        m.desc = lambda *a, **k: None
        m.Column = type('Column', (), {})
        m.Integer = int
        m.Text = str
        m.String = str
        # JSON type used in models
        class JSONType(dict):
            pass
        m.JSON = JSONType
        m.Boolean = bool
        m.Float = float
        m.DateTime = object
        m.and_ = lambda *a, **k: None
        orm = ModuleType('sqlalchemy.orm')
        def sessionmaker(*a, **k):
            return lambda *aa, **kk: None
        orm.sessionmaker = sessionmaker
        sys.modules['sqlalchemy.orm'] = orm
        # expose common types on orm module too
        orm.Integer = m.Integer
        orm.JSON = m.JSON
        orm.Text = m.Text

    # sklearn: provide pipeline.Pipeline and disable build checks
    if _mod == 'sklearn':
        pipe = ModuleType('sklearn.pipeline')
        class Pipeline:
            def __init__(self, *a, **k):
                pass
        pipe.Pipeline = Pipeline
        sys.modules['sklearn.pipeline'] = pipe
        m.pipeline = pipe
        # Provide a fake compiled-check module that scikit-learn expects
        chk = ModuleType('sklearn.__check_build')
        chk._check_build = lambda *a, **k: None
        sys.modules['sklearn.__check_build'] = chk
        # Some sklearn variants import the _check_build submodule directly
        chk_impl = ModuleType('sklearn.__check_build._check_build')
        def check_build():
            return True
        chk_impl.check_build = check_build
        sys.modules['sklearn.__check_build._check_build'] = chk_impl

    # langdetect: provide detect() helper
    if _mod == 'langdetect':
        def detect(s):
            # naive stub: treat ASCII as 'en', others as 'und'
            try:
                if not s:
                    return 'unknown'
                if isinstance(s, bytes):
                    s = s.decode('utf-8', errors='ignore')
                return 'en' if all(ord(c) < 128 for c in s) else 'und'
            except Exception:
                return 'und'
        m.detect = detect
    # pydantic.version shim
    if _mod == 'pydantic':
        try:
            pv = ModuleType('pydantic.version')
            pv.VERSION = '0.0.0'
            sys.modules['pydantic.version'] = pv
        except Exception:
            pass


def pytest_addoption(parser):
    """Add command line options to pytest."""
    parser.addoption(
        "--update-contracts",
        action="store_true",
        default=False,
        help="Update the contract test fixtures/schemas with generated outputs",
    )


@pytest.fixture
def update_contracts(request):
    """Fixture to check if --update-contracts was passed or environment variable is set."""
    return request.config.getoption("--update-contracts") or os.environ.get("UPDATE_CONTRACTS") == "1"

