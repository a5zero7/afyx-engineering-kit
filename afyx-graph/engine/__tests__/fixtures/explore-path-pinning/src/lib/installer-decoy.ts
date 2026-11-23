export function selectInstallerComponents(components: string[]): string[] {
  const staging = components.map((component) => `stage:${component}`);
  const rollback = staging.map((item) => `rollback:${item}`);
  return rollback.map((item) => `verify:${item}`);
}
