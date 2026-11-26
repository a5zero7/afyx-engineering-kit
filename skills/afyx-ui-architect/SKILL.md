---
name: afyx-ui-architect
description: Review or implement user interfaces, design systems, responsive layouts, and accessibility. Activate for explicit UI engineering tasks or approved manual selection. Exclude backend-only, API, schema, infrastructure, and text-only edits.
---

# Afyx UI Architect

1. Identify the affected user flow, states, and existing components. Locate the tokens for typography, spacing, color, and semantic feedback before introducing any new style. Complete this step when each planned change has an existing component or a concrete reason for a new one.
2. Define which content and actions stay visible as the viewport changes. Choose breakpoints around the content, and check narrow, wide, zoomed, and long-content cases for overflow and reflow. Complete this step when essential content and actions remain usable across the supported layouts.
3. Review semantic structure, labels, keyboard order, visible focus, contrast, and reduced-motion behavior. Check loading, empty, disabled, error, and success states. Complete this step when each changed interaction has an accessible name and usable feedback, and keyboard users can reach and operate it.
4. Verify the smallest affected interface. Record source findings and observations from any authorized runtime test separately. Browser diagnostics require their own explicit authorization.
