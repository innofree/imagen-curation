# tests

Lightweight smoke tests for the curation pipeline — **no GPU, no VL model, no
network**. They verify the `curation` package imports in the `app/` layout and
that config/paths/db/prompts/gpu-prep behave. Heavy deps (cv2/numpy/PIL/torch)
are `importorskip`-guarded, so the pure-python checks still run in a bare env.

## Run
```bash
pip install -r app/requirements-dev.txt      # pytest
pytest                                        # from the project root
```
`pytest.ini` sets `pythonpath = app`, so `from curation import ...` resolves
without installing the package.

## Layout
- `conftest.py` — puts `app/` on `sys.path` (belt-and-suspenders vs pytest.ini).
- `test_smoke.py` — package import, config defaults/overrides, taxonomy,
  path-resolution invariants, env overrides, prompt parsing, DB round-trip,
  GPU index resolution, and import-guarded cv2/curate checks.
