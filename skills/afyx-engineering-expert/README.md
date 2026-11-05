# Afyx Engineering Expert — v0.1.1

A single portable Agent Skill with 13 core disciplines, 16 supplemental specialist references, and 6 optional workflows. Its goal is adaptive, evidence-based product and software engineering across technologies, including ERP when relevant. No external scripts, runtime dependencies, MCP requirement, code borrowed from other projects, or implicit network access.

## Content

- `SKILL.md` — skill manifest, activation/routing, adaptive execution, quality contract.
- `references/*.md` — 13 core disciplines, 16 supplemental specialists, and `specialists-index.md` routing table.
- `workflows/*.md` — process guidance read only for matching tasks.
- `assets/result-template.md` — optional reviewer-ready result format.

## Codex CLI / VS Code

Copy the **folder** `afyx-engineering-expert` into your user skill directory, commonly `$HOME/.agents/skills/` (on Windows PowerShell: `$HOME\.agents\skills\`), or into the project's `.agents/skills/` for repo-scoped installation. Avoid duplicating a same-named copy across scopes. Verify discovery using the available skill picker or invoke `$afyx-engineering-expert`; re-open the Codex session if necessary. Refer to your installed Codex version's skill path when in doubt.

Example PowerShell from the directory containing the extracted folder:

```powershell
$dest = Join-Path $HOME '.agents\skills'
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item -Recurse -Force '.\afyx-engineering-expert' $dest
```

## ChatGPT

Where the **Skills** feature and upload permission are enabled for your account/workspace, go to Plugins > Skills > Create > Upload from computer and upload the ZIP containing this single top-level folder. Uploading/installation depends on account eligibility and workspace policy, and was **not** performed as part of this bundle. If Skills is unavailable on your account, use `SKILL.md` as a reference when drafting Project or custom instructions; this is not equivalent to installing the skill.

## Usage examples

- `Gunakan afyx-engineering-expert untuk audit arsitektur dan threat model pada layanan ini.`
- `Implementasikan perubahan berikut di repo; pilih domain relevan saja, uji negative dan regression paths.`
- `Tinjau workflow purchase-to-pay pada ERP versi yang ada, termasuk hak akses dan dampak akuntansi.`
- `Rancang evaluasi fitur AI berbasis dokumen dan jelaskan risiko kebocoran data.`

## Implementation status and acceptance boundary

This is an implemented, original, instruction-only skill v0.1.1, with its
routing, specialist references, optional workflows, and development regression
checks in the current Technical Alpha source. It is **not** a framework
certification, an autonomous engineer, or independent runtime evidence. Final
D.6 substantive review and controlled comparative acceptance are not yet
claimed. Verify installed host activation and task outputs before broad use.

The skill remains independently usable without Graph, Forge or ACE. It may
compose with [Afyx Odoo Engineering](../odoo-engineering/README.md) when a
version-specific ERP task actually requires it. The target repository and
runtime evidence remain authoritative.

Official references consulted for the packaging model:
- https://developers.openai.com/api/docs/guides/tools-skills
- https://developers.openai.com/plugins/build/skills
- https://help.openai.com/en/articles/20001066-skills-in-chatgpt
