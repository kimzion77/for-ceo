"""검토 앱 launcher — 감독관용 (포트 8501).

사용:
    python launch_streamlit.py

관리자 앱(`launch_admin.py`, port 8502)과 분리 운영.
한국어 경로 대응 (PYTHONIOENCODING=utf-8 + os.chdir).
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, "cgr", "web", "streamlit_app.py")

os.chdir(ROOT)
env = os.environ.copy()
env["PYTHONIOENCODING"] = "utf-8"
env["PYTHONPATH"] = ROOT

cmd = [
    sys.executable, "-m", "streamlit", "run", APP,
    "--server.port", "8501",
    "--server.address", "127.0.0.1",
    "--server.headless", "true",
]
print("[launch_streamlit]", " ".join(cmd), flush=True)
sys.exit(subprocess.call(cmd, env=env))
