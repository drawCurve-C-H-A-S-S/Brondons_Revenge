const STORAGE_KEY = "primeHintsEnabled";
let enabled = true;

export function getPrimeHintsEnabled() {
  return enabled;
}

export function initializePrimeHints() {
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== "false";
  } catch (error) {
    console.warn(
      "[PrimeHints] Could not load the saved hint preference:",
      error,
    );
  }
  document.body.classList.toggle("prime-hints-disabled", !enabled);
}

export function setPrimeHintsEnabled(value: boolean) {
  enabled = value;
  document.body.classList.toggle("prime-hints-disabled", !enabled);
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch (error) {
    console.warn("[PrimeHints] Could not save the hint preference:", error);
  }
}
