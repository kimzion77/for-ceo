"""이동됨 -> cgr.store.settings_store — 하위호환 alias (Streamlit·외부 스크립트용)."""
import sys

import cgr.store.settings_store as _moved

sys.modules[__name__] = _moved
