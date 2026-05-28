"""근로계약서(Employment Contract) 검토 모듈.

취업규칙은 cgr/ 루트에 직접, 근로계약서는 cgr/ec/ 별도 모듈로 분리.
공유 자원: WorkplaceContext, LLM 캐시, parsers (텍스트 파싱).
"""
from cgr.ec.catalog import EcSlot, EcCatalog, load_ec_catalog
from cgr.ec.verdict import classify_ec, ECBucket
from cgr.ec.run import review_ec_file, EcFinding, EcReport

__all__ = [
    "EcSlot",
    "EcCatalog",
    "load_ec_catalog",
    "classify_ec",
    "ECBucket",
    "review_ec_file",
    "EcFinding",
    "EcReport",
]
