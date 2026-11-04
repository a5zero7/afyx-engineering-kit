/**
 * Afyx Forge Core — Observable Task Classifier
 * Analyzes task input (text or task file) and classifies it into
 * the 6 standard Forge A0-A3 categories, assessing risk, framework, and safety boundaries.
 */

export const TASK_CATEGORIES = Object.freeze({
  KNOWN_FILE_BUG: 'KNOWN_FILE_BUG',
  UNKNOWN_DEFECT_DIAGNOSIS: 'UNKNOWN_DEFECT_DIAGNOSIS',
  CROSS_MODULE_CHANGE: 'CROSS_MODULE_CHANGE',
  SECURITY_SENSITIVE: 'SECURITY_SENSITIVE',
  DATA_RELIABILITY: 'DATA_RELIABILITY',
  NEGATIVE_SIMPLE: 'NEGATIVE_SIMPLE',
});

export const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

const UNSAFE_DEFINITIONS = [
  {
    regex: /\b(?:force[\s_-]?push|push\s+(?:--force|-f))\b/i,
    description: 'Unauthorized autonomous push or force-push directive detected',
  },
  {
    regex: /\b(?:bypass[\s_-]?(?:security|guard|gate|review)|ignore\s+permissions?)\b/i,
    description: 'Bypassing security checks, review gates, or permission controls is prohibited',
  },
  {
    regex: /\b(?:expose|leak|dump)\s+(?:secret|token|api_key|password|credential|private_key)\b/i,
    description: 'Directives to dump or expose secrets or private credentials are prohibited',
  },
  {
    regex: /\b(?:rm\s+-rf\s+[\/\*]|format\s+[c-z]:|drop\s+database\s+prod)\b/i,
    description: 'Destructive filesystem or database deletion directives are prohibited',
  },
];

const ODOO_PATTERNS = [
  /\bodoo\b/i,
  /\b__manifest__\.py\b/,
  /\bir\.model\.access\.csv\b/,
  /\b(?:_inherit|_name)\s*=\s*['"][a-zA-Z0-9_\.]+['"]/,
  /\baddons\b[\/\\][a-zA-Z0-9_]+/,
];

const SECURITY_PATTERNS = [
  /\b(?:vulnerab|exploit|cve|xss|sql[\s_-]?injection|csrf|timing[\s_-]?attack)\b/i,
  /\b(?:auth(?:entication|orization)?|oauth|jwt|session|crypto|cipher|secret|credential|acl|rbac)\s+(?:fix|bug|leak|audit|token|login|logout|grant|permission)\b/i,
];

const DATA_PATTERNS = [
  /\b(?:migration|schema|alembic|transaction|rollback|integrity|foreign\s+key|table\s+drop|data\s+loss)\b/i,
];

const CROSS_MODULE_PATTERNS = [
  /\b(?:cross[\s_-]?(?:module|service|package|component)|across\s+(?:modules|services|packages|components)|inter[\s_-]service|multi[\s_-]component|interface\s+contract|dependency\s+graph)\b/i,
];

const UNKNOWN_DEFECT_PATTERNS = [
  /\b(?:diagnos|investigat|unknown\s+(?:cause|defect|bug)|reproduc|intermittent|root[\s_-]cause|flaky|traceback|stacktrace)\b/i,
];

const SIMPLE_PATTERNS = [
  /\b(?:typo|format(?:ting)?|comment|docstring|readme|lint\s+fix|simple\s+rename|whitespace)\b/i,
];

/**
 * Checks if task content contains unsafe requests forbidden by Bounded Execution.
 * @param {string} text
 * @returns {{ isUnsafe: boolean, reason?: string }}
 */
export function checkUnsafeRequest(text) {
  for (const def of UNSAFE_DEFINITIONS) {
    if (def.regex.test(text)) {
      return {
        isUnsafe: true,
        reason: `${def.description} (pattern: ${def.regex.source})`,
      };
    }
  }
  return { isUnsafe: false };
}

/**
 * Extracts referenced file paths from task text.
 * @param {string} text
 * @returns {string[]}
 */
export function extractReferencedFiles(text) {
  const matches = new Set();
  const fileRegex = /(?:[a-zA-Z0-9_\-\.\/\\]+\.(?:py|js|ts|mjs|cjs|json|xml|csv|md|ya?ml|html|css|sh|ps1|toml))/gi;
  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    const candidate = match[0].trim();
    if (!candidate.startsWith('http://') && !candidate.startsWith('https://')) {
      matches.add(candidate.replace(/\\/g, '/'));
    }
  }
  return Array.from(matches);
}

/**
 * Classifies an incoming task based on text content and optional explicit attributes.
 * @param {string} taskText
 * @param {object} [metadata={}]
 * @returns {object} Classification result
 */
export function classifyTask(taskText, metadata = {}) {
  const rawText = (taskText || '').trim();
  const referencedFiles = extractReferencedFiles(rawText);

  // Check safety first
  const safetyCheck = checkUnsafeRequest(rawText);
  if (safetyCheck.isUnsafe) {
    return {
      status: 'REFUSED_UNSAFE',
      refusalReason: safetyCheck.reason,
      primaryCategory: TASK_CATEGORIES.SECURITY_SENSITIVE,
      riskLevel: RISK_LEVELS.CRITICAL,
      confidence: 1.0,
      referencedFiles,
      frameworks: [],
      observedComplexity: 'CRITICAL',
    };
  }

  // Detect frameworks
  const frameworks = [];
  if (ODOO_PATTERNS.some((re) => re.test(rawText)) || referencedFiles.some((f) => f.includes('__manifest__.py') || f.endsWith('ir.model.access.csv'))) {
    frameworks.push('Odoo');
  }
  if (/\b(?:typescript|ts-node|tsconfig\.json)\b/i.test(rawText) || referencedFiles.some((f) => f.endsWith('.ts') || f.endsWith('.tsx'))) {
    frameworks.push('TypeScript');
  }
  if (/\b(?:python|pytest|pip|requirements\.txt)\b/i.test(rawText) || referencedFiles.some((f) => f.endsWith('.py'))) {
    frameworks.push('Python');
  }

  // Determine category & risk
  let category = TASK_CATEGORIES.UNKNOWN_DEFECT_DIAGNOSIS;
  let risk = RISK_LEVELS.MEDIUM;
  let complexity = 'MEDIUM';
  let confidence = 0.85;

  if (SECURITY_PATTERNS.some((re) => re.test(rawText))) {
    category = TASK_CATEGORIES.SECURITY_SENSITIVE;
    risk = RISK_LEVELS.HIGH;
    complexity = 'HIGH';
    confidence = 0.95;
  } else if (DATA_PATTERNS.some((re) => re.test(rawText))) {
    category = TASK_CATEGORIES.DATA_RELIABILITY;
    risk = RISK_LEVELS.HIGH;
    complexity = 'HIGH';
    confidence = 0.90;
  } else if (CROSS_MODULE_PATTERNS.some((re) => re.test(rawText)) || referencedFiles.length > 3) {
    category = TASK_CATEGORIES.CROSS_MODULE_CHANGE;
    risk = RISK_LEVELS.MEDIUM;
    complexity = 'HIGH';
    confidence = 0.88;
  } else if (SIMPLE_PATTERNS.some((re) => re.test(rawText)) && referencedFiles.length <= 1) {
    category = TASK_CATEGORIES.NEGATIVE_SIMPLE;
    risk = RISK_LEVELS.LOW;
    complexity = 'LOW';
    confidence = 0.95;
  } else if (referencedFiles.length === 1 && !UNKNOWN_DEFECT_PATTERNS.some((re) => re.test(rawText))) {
    category = TASK_CATEGORIES.KNOWN_FILE_BUG;
    risk = RISK_LEVELS.LOW;
    complexity = 'LOW';
    confidence = 0.92;
  } else if (UNKNOWN_DEFECT_PATTERNS.some((re) => re.test(rawText))) {
    category = TASK_CATEGORIES.UNKNOWN_DEFECT_DIAGNOSIS;
    risk = RISK_LEVELS.MEDIUM;
    complexity = 'MEDIUM';
    confidence = 0.85;
  }

  return {
    status: 'PLANNED',
    primaryCategory: category,
    riskLevel: risk,
    observedComplexity: complexity,
    confidence,
    frameworks,
    referencedFiles,
  };
}
