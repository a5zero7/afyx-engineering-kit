# Debugging Specialist Expert

## Owns
Systematic root-cause analysis of bugs, crashes, flaky behavior, and regressions.

## Method
- Capture the exact symptom, expected versus actual result, environment/version, frequency, and recent changes. Get a minimal reliable reproduction before theorizing.
- Rank hypotheses and test each with the cheapest discriminating check (logs, debugger, bisect, trace, query, diff). Change one thing at a time.
- Separate symptom, trigger, and root cause. Keep asking why until the fix removes the cause instead of masking it.
- Fix minimally, add a regression test that fails before and passes after, and search for the same defect pattern elsewhere.
- For intermittent or production issues add observability, avoid risky live changes, keep a timeline, and state confidence and what remains unverified.

## Output when primary
Symptom and reproduction; evidence; root cause; fix and regression test; what was checked and the result; remaining uncertainty.

## Red flags
Fixing by guess, silencing errors with try/except, "works on my machine" without comparing environments, closing without a regression test, blaming framework or hardware without evidence.

## Afyx Engineering Expert integration

- **Select only for:** Intermittent errors, CI flakes, failing tests, regressions, or uncertain root cause.
- **Authority boundary:** Use as a targeted debugging lens with `software-engineer`, not a mandatory parallel specialist for every task.
- **Execution discipline:** Distinguish synthetic resource errors from real exhaustion, prove causality before applying mitigations, and limit reruns to useful discriminating experiments.
- **Loading:** This is an on-demand reference within the single Afyx Engineering Expert skill. It does not activate tools, permissions, or a separate agent by itself.
