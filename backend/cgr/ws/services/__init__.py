"""임금명세서 처리 단계별 서비스.

  extract.py  — 파일(이미지·PDF·HWP 등) → 텍스트 (공용 parsers.dispatcher 위임)
  analyze.py  — 텍스트 + 컨텍스트 → 11개 슬롯 위반 분석 dict
"""
