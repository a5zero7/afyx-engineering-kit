from pathlib import Path


source = Path("module/models.py").read_text(encoding="utf-8")
assert "fields.Command" not in source
assert "(6, 0, tag_ids)" in source
print("compatibility check passed")
