#!/usr/bin/env python3
"""Zero-token skill routing validation.

Evaluates deterministic routing fixtures (evals/routing/cases.json) against a
static keyword model of each skill's activation intent (evals/routing/router.json)
and runs static description-collision checks. No model, no network.

This is a regression guard for routing INTENT. It does not prove how any model
routes at runtime.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ROUTING_ROOT = REPO_ROOT / "evals" / "routing"
ROUTER_PATH = ROUTING_ROOT / "router.json"
CASES_PATH = ROUTING_ROOT / "cases.json"

REQUIRED_SCENARIOS = {
    "ai-data-review",
    "expert-architecture",
    "expert-odoo-process",
    "expert-security",
    "general-coding",
    "odoo-coding",
    "production-reliability",
    "prompt-authoring",
    "odoo-prompt-authoring",
    "general-conversation",
}
STOPWORDS = {
    "a", "an", "and", "are", "as", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or",
    "the", "to", "with", "not", "only", "when", "that", "this", "use", "user", "does", "do", "etc",
    "activates", "applies", "work", "tasks", "task", "specific", "explicitly", "asks",
}
COLLISION_JACCARD = 0.5


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def compile_signals(router: dict) -> dict[str, list[re.Pattern[str]]]:
    return {name: [re.compile(pattern, re.IGNORECASE) for pattern in patterns] for name, patterns in router["signals"].items()}


def matches(signals: dict[str, list[re.Pattern[str]]], name: str, prompt: str) -> bool:
    return any(pattern.search(prompt) for pattern in signals[name])


def intents(router: dict, prompt: str, signals: dict[str, list[re.Pattern[str]]] | None = None) -> dict[str, bool]:
    signals = signals or compile_signals(router)
    verb = matches(signals, "coding_verbs", prompt)
    noun = matches(signals, "coding_nouns", prompt)
    strong = matches(signals, "coding_strong", prompt)
    document = matches(signals, "document_only", prompt)
    coding = (strong or (verb and noun)) and not (document and not strong)
    return {
        "prompt_authoring": matches(signals, "prompt_authoring", prompt),
        "odoo_domain": matches(signals, "odoo_domain", prompt),
        "coding": coding,
        "expert_domain": matches(signals, "expert_domain", prompt),
    }


def evaluate_rule(expression: str, facts: dict[str, bool]) -> bool:
    """Evaluate a rule: intent names combined with and / or / not / parentheses (not > and > or)."""
    tokens = re.findall(r"\(|\)|[a-z_]+", expression)
    position = 0

    def peek() -> str | None:
        return tokens[position] if position < len(tokens) else None

    def take() -> str:
        nonlocal position
        token = tokens[position]
        position += 1
        return token

    def parse_or() -> bool:
        value = parse_and()
        while peek() == "or":
            take()
            value = parse_and() or value
        return value

    def parse_and() -> bool:
        value = parse_not()
        while peek() == "and":
            take()
            value = parse_not() and value
        return value

    def parse_not() -> bool:
        if peek() == "not":
            take()
            return not parse_not()
        return parse_atom()

    def parse_atom() -> bool:
        token = take()
        if token == "(":
            value = parse_or()
            if take() != ")":
                raise ValueError(f"unbalanced parentheses in rule: {expression!r}")
            return value
        if token not in facts:
            raise ValueError(f"unknown intent {token!r} in rule: {expression!r}")
        return facts[token]

    result = parse_or()
    if position != len(tokens):
        raise ValueError(f"unexpected trailing tokens in rule: {expression!r}")
    return result


def route(router: dict, prompt: str, signals: dict[str, list[re.Pattern[str]]] | None = None) -> set[str]:
    """Return the set of skills the static model activates for a prompt."""
    facts = intents(router, prompt, signals)
    return {rule["skill"] for rule in router["rules"] if evaluate_rule(rule["when"], facts)}


def check_case(router: dict, case: dict, signals=None) -> list[str]:
    active = route(router, case["prompt"], signals)
    required, allowed, forbidden = set(case["required"]), set(case["allowed"]), set(case["forbidden"])
    problems = []
    if not required <= active:
        problems.append(f"missing required skill(s): {sorted(required - active)}")
    unexpected = active - required - allowed
    if unexpected:
        problems.append(f"unexpected skill(s) activated: {sorted(unexpected)}")
    hit = active & forbidden
    if hit:
        problems.append(f"forbidden skill(s) activated: {sorted(hit)}")
    return problems


def description_of(skill: str, spec: dict) -> str:
    if spec["source"] == "upstream":
        return spec["description_snapshot"]
    text = (REPO_ROOT / spec["skill_file"]).read_text(encoding="utf-8")
    match = re.search(r"(?m)^description:\s*(.+)$", text)
    if not match:
        raise SystemExit(f"{skill}: SKILL.md has no description")
    return match.group(1).strip()


def significant_tokens(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z][a-z-]{2,}", text.lower()) if token not in STOPWORDS}


def static_checks(router: dict, cases: dict) -> list[str]:
    problems: list[str] = []
    skills = router["skills"]
    descriptions = {name: description_of(name, spec) for name, spec in skills.items()}

    # Every anchor the model relies on must still be present in the skill's description.
    for name, spec in skills.items():
        for anchor in spec["anchors"]:
            if anchor.lower() not in descriptions[name].lower():
                problems.append(f"{name}: description no longer contains routing anchor {anchor!r}; re-evaluate the routing model")

    # Obvious description collision: near-identical significant vocabulary.
    names = sorted(skills)
    for index, first in enumerate(names):
        for second in names[index + 1:]:
            a, b = significant_tokens(descriptions[first]), significant_tokens(descriptions[second])
            jaccard = len(a & b) / len(a | b) if a | b else 0.0
            if jaccard >= COLLISION_JACCARD:
                problems.append(f"description collision: {first} vs {second} (Jaccard {jaccard:.2f} >= {COLLISION_JACCARD})")

    # The two skills that must stay mutually exclusive say so in their own descriptions.
    if "prompt writing" not in descriptions["efficient-coding"].lower():
        problems.append("efficient-coding must exclude prompt writing in its description")
    if "coding tasks" not in descriptions["prompt-master"].lower():
        problems.append("prompt-master must exclude coding tasks in its description")

    # Rule targets must exist and rules must only use the fixed vocabulary.
    vocabulary = {"prompt_authoring", "odoo_domain", "coding", "expert_domain", "and", "or", "not"}
    for rule in router["rules"]:
        if rule["skill"] not in skills:
            problems.append(f"rule targets unknown skill {rule['skill']}")
        words = set(re.findall(r"[a-z_]+", rule["when"]))
        if not words <= vocabulary:
            problems.append(f"rule for {rule['skill']} uses unknown terms: {sorted(words - vocabulary)}")
    targets = [rule["skill"] for rule in router["rules"]]
    if sorted(targets) != sorted(set(targets)):
        problems.append("more than one rule targets the same skill")
    if set(targets) != set(skills):
        problems.append("every skill needs exactly one routing rule")

    # Fixture hygiene and coverage.
    seen: set[str] = set()
    scenarios = set()
    required_somewhere: set[str] = set()
    forbidden_somewhere: set[str] = set()
    for case in cases["cases"]:
        cid = case["id"]
        if cid in seen:
            problems.append(f"duplicate case id {cid}")
        seen.add(cid)
        scenarios.add(case["scenario"])
        for key in ("required", "allowed", "forbidden"):
            unknown = set(case[key]) - set(skills)
            if unknown:
                problems.append(f"{cid}: {key} names unknown skill(s) {sorted(unknown)}")
        overlap = (set(case["required"]) | set(case["allowed"])) & set(case["forbidden"])
        if overlap:
            problems.append(f"{cid}: skill(s) {sorted(overlap)} are both wanted and forbidden")
        required_somewhere |= set(case["required"])
        forbidden_somewhere |= set(case["forbidden"])
    missing_scenarios = REQUIRED_SCENARIOS - scenarios
    if missing_scenarios:
        problems.append(f"missing scenario coverage: {sorted(missing_scenarios)}")
    for name in skills:
        if name not in required_somewhere:
            problems.append(f"no case requires {name}")
        if name not in forbidden_somewhere:
            problems.append(f"no case forbids {name}")
    return problems


def main() -> int:
    router, cases = load(ROUTER_PATH), load(CASES_PATH)
    signals = compile_signals(router)
    problems = static_checks(router, cases)
    failures = 0
    for case in cases["cases"]:
        for problem in check_case(router, case, signals):
            failures += 1
            problems.append(f"case {case['id']}: {problem}  (prompt: {case['prompt']!r})")
    if problems:
        for problem in problems:
            print(f"FAIL {problem}")
        print(f"Routing validation: FAIL ({len(problems)} problem(s), {len(cases['cases'])} cases)")
        return 1
    print(f"Routing validation: PASS ({len(cases['cases'])} cases; zero-token static model, not runtime routing evidence)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
