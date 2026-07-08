"""이동됨 -> cgr.store.access_log — 하위호환 alias (Streamlit·외부 스크립트용)."""
import sys

import cgr.store.access_log as _moved

sys.modules[__name__] = _moved
