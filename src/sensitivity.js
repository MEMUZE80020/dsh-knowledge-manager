const STRONG = [
  /密码|口令|私钥/i,
  /\btoken\b/i,
  /密钥|\bapi[_-]?key\b|\bsecret\b/i,
  /账号|账户|身份证|手机号|\bpassword\b/i,
]

const WEAK = [
  /公司|经营|财务|工资|薪|合同|客户|内部|私密|机密|营收|利润|发票|预算|股权|人事/i,
]

export const DEFAULT_KEYWORDS = {
  strong: STRONG.map((r) => r.source),
  weak: WEAK.map((r) => r.source),
}

/**
 * Classify one knowledge point.
 * hint comes from the agent; keywords always win over a 'safe' hint.
 */
export function classifySensitivity(text, hint = '') {
  const value = String(text ?? '')
  const strong = STRONG.some((re) => re.test(value))
  if (strong || hint === 'sensitive') return 'sensitive'
  if (hint === 'uncertain') return 'uncertain'
  if (WEAK.some((re) => re.test(value))) return 'uncertain'
  return 'safe'
}

export function sensitivityForSync(sensitivity) {
  return sensitivity === 'safe' ? 1 : 0
}
