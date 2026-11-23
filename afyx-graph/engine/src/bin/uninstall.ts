#!/usr/bin/env node
// npm has no verified provider ownership receipt. Preserve registrations and
// leave their removal to the explicit, ownership-aware kit lifecycle.
if (process.env.AFYX_SKIP_PREUNINSTALL !== '1') {
  process.stderr.write('Afyx Graph: provider registrations preserved. Use the kit ownership-aware uninstall for configuration cleanup.\n');
}
