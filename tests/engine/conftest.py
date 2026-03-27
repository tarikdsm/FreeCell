from __future__ import annotations

import os
import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
WHEEL_DIR = REPO_ROOT / "target" / "python-wheels"


def ensure_python_binding() -> None:
    try:
        __import__("freecell_py")
        return
    except ImportError:
        pass

    env = os.environ.copy()
    cargo_bin = pathlib.Path.home() / ".cargo" / "bin"
    env["PATH"] = f"{cargo_bin}{os.pathsep}{env.get('PATH', '')}"
    WHEEL_DIR.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            sys.executable,
            "-m",
            "maturin",
            "build",
            "--release",
            "--manifest-path",
            str(REPO_ROOT / "crates" / "freecell_py" / "Cargo.toml"),
            "--interpreter",
            sys.executable,
            "--out",
            str(WHEEL_DIR),
        ],
        check=True,
        cwd=REPO_ROOT,
        env=env,
    )

    wheels = sorted(WHEEL_DIR.glob("freecell_py-*.whl"))
    if not wheels:
        raise RuntimeError("maturin did not produce a freecell_py wheel")

    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--force-reinstall",
            "--no-deps",
            str(wheels[-1]),
        ],
        check=True,
        cwd=REPO_ROOT,
        env=env,
    )


def pytest_sessionstart() -> None:
    ensure_python_binding()
