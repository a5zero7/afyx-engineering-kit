from pathlib import Path


def resolve_export_path(root: Path, requested: str) -> Path:
    """Resolve an export destination that must remain inside root."""
    return (root / requested).resolve()
