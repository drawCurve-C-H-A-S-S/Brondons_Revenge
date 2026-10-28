let enabled = true;

export function getPrimeHintsEnabled() {
  return enabled;
}

export function initializePrimeHints() {
  enabled = true;
  document.body.classList.toggle("prime-hints-disabled", !enabled);
}

export function setPrimeHintsEnabled(value: boolean) {
  enabled = value;
  document.body.classList.toggle("prime-hints-disabled", !enabled);
}
