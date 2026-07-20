"""Test bootstrap.

The `curation` package lives at <project>/app/curation, so app/ must be on
sys.path. pytest.ini already sets `pythonpath = app`; this repeats it so the
suite also runs when invoked from an unusual cwd or without the ini.
"""
import os
import sys

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_APP_DIR = os.path.join(_PROJECT_ROOT, "app")
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)
