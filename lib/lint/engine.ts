export type Severity = 'error' | 'warning' | 'advisory';
export type RuleCategory = 'slop' | 'quality';

export interface DesignSystem {
  fontFamilies?: string[];
  colors?: string[];
  radii?: number[];
  fontSizes?: number[];
}

export interface ScanConfig {
  disabledRules?: string[];
  disabledValues?: { rule: string; value: string }[];
  lineLengthMax?: number;
  designSystem?: DesignSystem;
  skipScan?: boolean;
}

export interface RuleHit {
  detail: string;
  ignoreValue?: string;
}

export interface PageHit extends RuleHit {
  el?: Element;
}

export interface RuleMeta {
  id: string;
  category: RuleCategory;
  severity?: Severity;
  name: string;
  description: string;
  skillSection?: string;
}

export interface ElementRule extends RuleMeta {
  scope: 'element';
  test(el: Element, ctx: ScanContext): RuleHit[];
}

export interface PageRule extends RuleMeta {
  scope: 'page';
  test(ctx: ScanContext): PageHit[];
}

export type Rule = ElementRule | PageRule;

export interface Finding {
  ruleId: string;
  name: string;
  description: string;
  severity: Severity;
  category: RuleCategory;
  advisory: boolean;
  skillSection?: string;
  el?: Element;
  detail: string;
  ignoreValue?: string;
}

export interface ScanContext {
  doc: Document;
  win: Window;
  config: ScanConfig;
  style(el: Element, pseudo?: string): CSSStyleDeclaration;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly hostname: string;
}

export function createScanContext(win: Window, config: ScanConfig = {}): ScanContext {
  const normalizedConfig: ScanConfig = { lineLengthMax: 80, ...config };
  const cache = new Map<Element, Map<string | undefined, CSSStyleDeclaration>>();
  const style = (el: Element, pseudo?: string): CSSStyleDeclaration => {
    let elementCache = cache.get(el);
    if (!elementCache) {
      elementCache = new Map();
      cache.set(el, elementCache);
    }
    if (!elementCache.has(pseudo)) {
      elementCache.set(pseudo, win.getComputedStyle(el, pseudo));
    }
    return elementCache.get(pseudo)!;
  };

  return {
    doc: win.document,
    win,
    config: normalizedConfig,
    style,
    innerWidth: win.innerWidth,
    innerHeight: win.innerHeight,
    scrollX: win.scrollX,
    scrollY: win.scrollY,
    hostname: win.location.hostname,
  };
}

// This single live-DOM engine intentionally drops impeccable's multi-engine Dom trait.
export function collectFindings(rules: Rule[], ctx: ScanContext): Finding[] {
  if (ctx.config.skipScan) return [];

  const findings: Finding[] = [];
  const elements = ctx.doc.querySelectorAll('*');
  const elementRules = rules.filter((rule): rule is ElementRule => rule.scope === 'element');
  const pageRules = rules.filter((rule): rule is PageRule => rule.scope === 'page');

  for (const el of elements) {
    for (const rule of elementRules) {
      for (const hit of rule.test(el, ctx)) {
        findings.push(toFinding(rule, hit, el));
      }
    }
  }
  for (const rule of pageRules) {
    for (const hit of rule.test(ctx)) {
      findings.push(toFinding(rule, hit, hit.el));
    }
  }

  const disabledRules = new Set(ctx.config.disabledRules ?? []);
  const disabledValues = ctx.config.disabledValues ?? [];
  return findings.filter((finding) => {
    if (disabledRules.has(finding.ruleId)) return false;
    return !disabledValues.some(
      (waiver) => waiver.rule === finding.ruleId && waiver.value === finding.ignoreValue,
    );
  });
}

function toFinding(rule: Rule, hit: RuleHit, el: Element | undefined): Finding {
  const severity = rule.severity ?? 'warning';
  const finding: Finding = {
    ruleId: rule.id,
    name: rule.name,
    description: rule.description,
    severity,
    category: rule.category,
    advisory: severity === 'advisory',
    el,
    detail: hit.detail,
  };
  if (rule.skillSection !== undefined) finding.skillSection = rule.skillSection;
  if (hit.ignoreValue !== undefined) finding.ignoreValue = hit.ignoreValue;
  return finding;
}
