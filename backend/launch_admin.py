"""관리자 대시보드 launcher — 한국어 경로 + 포트 8502 대응.

사용:
    python launch_admin.py

기본 검토 앱(`launch_streamlit.py`, port 8501)과 분리 운영.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, "cgr", "web", "admin", "admin_app.py")

os.chdir(ROOT)
env = os.environ.copy()
env["PYTHONIOENCODING"] = "utf-8"
env["PYTHONPATH"] = ROOT

cmd = [
    sys.executable, "-m", "streamlit", "run", APP,
    "--server.port", "8502",
    "--server.address", "127.0.0.1",
    "--server.headless", "true",
]
print("[launch_admin]", " ".join(cmd), flush=True)
sys.exit(subprocess.call(cmd, env=env))
