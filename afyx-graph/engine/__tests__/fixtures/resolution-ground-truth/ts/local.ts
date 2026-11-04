export function localTarget(): number {
  return 1;
}

export function localCaller(): number {
  return localTarget();
}
