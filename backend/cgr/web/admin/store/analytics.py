"""이동됨 -> cgr.store.analytics — 하위호환 alias (Streamlit·외부 스크립트용)."""
import sys

import cgr.store.analytics as _moved

sys.modules[__name__] = _moved
