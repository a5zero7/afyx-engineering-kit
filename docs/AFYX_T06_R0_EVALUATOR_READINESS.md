# T06.R0 Independent Evaluator Environment Readiness

Observed: **2026-10-15**  
Development baseline: `2f1dae39c923a95d1537cf9ef1be87905a192e17`  
Related work: AFYX-283 / T06.R  
Verdict: **BLOCKED — INDEPENDENT SECURITY PRINCIPAL NOT PROVISIONED**

This is a sanitized environment-readiness record. It contains no private path,
credential, canary value, raw response, rubric, holdout, or evaluator answer.
No D.6 review, D.5 rerun, model evaluation, source change, account creation, or
ACL modification was performed.

## Observed topology

| Domain | Current execution boundary | Observation |
|---|---|---|
| Developer | Current standard Windows user and development workspace | Workspace read/write succeeds. |
| Evaluated agent | Codex child processes under the same Windows principal, with MXC policy as a process sandbox | MXC may restrict a child workload, but it is not a distinct OS identity from the developer/controller. |
| Trusted evaluator | Not provisioned as a separately authenticated execution identity | No independent evaluator negative controls can be executed. |
| Public source | Development workspace on a separate drive from the user profile | Workspace ACL inheritance is enabled and includes broad local principal classes. |
| Codex configuration, skills, and attachments | Current user profile | Shared with the developer identity; ACL inheritance is enabled and includes the current user and broad local principal classes. |
| D.5 archive | Public ledger classifies it as owner-controlled LocalAppData outside the repository | The developer session did not resolve its private path, inspect its contents, or independently verify its ACL. |

The active Codex processes observed during assessment all ran as the current
developer Windows principal. The current token was not elevated, but account
separation is still absent. Different conversations or sandbox policies under
that same principal do not establish the required developer-versus-reviewer
filesystem boundary. Host filesystem drives and the current user profile remain
part of the developer execution context; no dedicated evaluator VM, isolated
home, or evaluator-only mounted volume was observed.

## Permission findings

1. **High — no trusted-evaluator principal.** No explicit evaluator identity is
   configured or bound to the evidence. Therefore reviewer-only read/write
   controls cannot be verified from the intended identity.
2. **High — shared developer configuration boundary.** Codex configuration,
   installed skills, and attachments are under the developer profile and inherit
   ACLs that include broader local principals. They cannot hold reviewer-only
   material safely in the current arrangement.
3. **High — archive isolation is not independently verified.** The committed
   record states that the archive permits owner and SYSTEM, but the owner is the
   same security domain used for current development. This session intentionally
   did not inspect the private archive. A repository claim is not an enforcement
   test.
4. **Medium — workspace ACL is not an evaluator boundary.** It is inherited and
   includes local Users-class access. It is suitable for development, not for
   reviewer-only evidence.

## Isolation control matrix

| Control | Identity used | Result | Evidence / limitation |
|---|---|---|---|
| Authorized development-workspace read | Developer | PASS | Synthetic non-secret file read succeeded. |
| Authorized development-workspace write | Developer | PASS | Synthetic non-secret update succeeded; probe cleanup succeeded. |
| Evaluated-agent scenario-workspace read/write | Distinct evaluated-agent principal | BLOCKED | No distinct principal is provisioned; existing children share the developer principal. |
| Evaluator-only read denied to developer | Developer | NOT RUN | Testing the real archive would violate the reviewer boundary; no synthetic evaluator domain exists. |
| Evaluator-only write denied to developer | Developer | NOT RUN | Same blocker. |
| Evaluator-only read/write denied to evaluated agent | Distinct evaluated-agent principal | NOT RUN | Same blocker. |
| Parent traversal and alternate-path denial | Developer and evaluated agent | NOT RUN | Requires a provisioned evaluator-only filesystem domain. |
| Shared config/tool endpoint does not expose reviewer data | All domains | BLOCKED | Current Codex configuration and attachments are shared with the developer identity. |
| Canary absent from developer-visible output | Developer | NOT RUN | No evaluator-domain synthetic canary was created because enforcement is absent. |
| Trusted evaluator accesses only explicitly granted material | Trusted evaluator | NOT RUN | Trusted evaluator identity is not provisioned. |

No failed negative control is represented as a PASS. No canary content was
created or emitted.

## Provenance

| Item | Expected identity | Verification |
|---|---|---|
| Expert candidate | `0.1.1` | Public source metadata; unchanged. |
| Candidate directory-content SHA-256 | `06d947c595f164ed1ad94e8ef97aa412a3ec7559c5f79cb467f0ec1ad488095c` | PASS, recomputed from public source. |
| MXC environment SHA-256 | `6203b5dd2f016fade8b04c1d2fd02be5ed8bf24763d1a4404e6931cbb4447c6c` | PASS, recomputed from the committed environment file. |
| D.5 run ID | `384826dee91d45f0a3388d5d276407ae` | RECORDED ONLY; archive correlation was not reopened. |
| Archive manifest SHA-256 | `799d34b5934928606954b6fb19b3f8b834e010224a558c85cdfcd527dd48e926` | RECORDED ONLY; actual archive and individual files were not accessed. |

## Required isolated design

Use a dedicated evaluator VM with an independently authenticated, non-developer
standard account. A dedicated VM is preferred over another local account because
it permits explicit removal of shared drives, clipboard, home directories,
Codex configuration, attachments, credentials, and tool endpoints.

The owner-controlled setup must:

1. Keep the original verified D.5 archive in place and create a separately
   hashed review copy; never relocate or delete the only verified copy.
2. Give the trusted reviewer read-only access to that copy and approved review
   inputs, plus a separate private output directory. Do not mount these paths in
   the developer or evaluated-agent environment.
3. Give the evaluated agent only a disposable scenario workspace and the exact
   candidate skill. Use a separate home/config root and no reviewer credentials.
4. Disable shared folders, host-drive redirection, clipboard/file transfer,
   inherited host attachments, and unapproved network/tool endpoints.
5. Apply explicit least-privilege ACLs inside the isolated environment, then run
   synthetic positive and negative controls from the actual developer,
   evaluated-agent, and reviewer identities. Record only sanitized outcomes and
   evidence hashes.
6. Verify archive manifest and all individual file hashes from the reviewer
   identity before T06.R begins.

Residual trusted access must be documented: the owner/controller, host or VM
administrator, hypervisor operator, backup operator, and anyone able to read the
VM disk or snapshots can bypass guest ACLs. Readiness is not absolute isolation;
it is an explicit, independently tested trust boundary.

## Readiness decision

**BLOCKED.** The current environment has no independently authenticated trusted
evaluator and cannot execute the required cross-principal denial tests. T06.R,
candidate freeze, and T07 must not start. Readiness can be reconsidered only
after the owner provisions the isolated design and supplies sanitized results
for every required control above.
