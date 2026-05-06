const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^your-/i,
  /^xxxx[.\w-]*/i,
  /^\[.*\]$/,
  /example\.com/i,
  /dbname/i,
  /password@host/i,
];

export function isPlaceholderValue(value) {
  const normalized = String(value || '').trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasRealEnvValue(name) {
  return !isPlaceholderValue(process.env[name]);
}

export function requireRealEnvValue(name, description = name) {
  if (!hasRealEnvValue(name)) {
    throw new Error(`${description} is not configured. Set ${name} in .env.`);
  }

  return process.env[name].trim();
}
