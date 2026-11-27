// Copyright (c) 2026 Afyx

const SECRET_NAME = /^(?:password|passwd|secret|token|credential|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|private[_-]?key)$/i;
const SECRET_TEXT = /\b(?:Bearer|Basic)\s+[^\s,;"']+|(?:\b(?:password|passwd|secret|token|credential|api[_-]?key|authorization|cookie|private[_-]?key)\s*["']?\s*[:=]\s*\S)|-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/i;

function containsPrivateValue(value) {
  if (typeof value === 'string') return SECRET_TEXT.test(value);
  if (Array.isArray(value)) return value.some(containsPrivateValue);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([name, entry]) => SECRET_NAME.test(name) || containsPrivateValue(entry));
  }
  return false;
}

export function redactSensitiveText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, '[REDACTED_AUTH]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, '[REDACTED_TOKEN]')
    .replace(/(\b(?:password|passwd|secret|token|credential|api[_-]?key|authorization|cookie|private[_-]?key)\s*["']?\s*[:=]\s*)([^\s,;'"`]+)/gi, '$1[REDACTED]');
}

export function canPersistSegment(segment) {
  return segment.classification !== 'security' &&
    !containsPrivateValue(segment.content) && !containsPrivateValue(segment.provenance);
}
