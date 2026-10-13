export function verifyResult(state) {
  const errors = [];
  if (state?.searched !== true) errors.push('Search must have completed.');
  if (state?.filters?.city !== 'Lisbon') errors.push('Selected city must be Lisbon.');
  if (state?.filters?.style !== 'Design') errors.push('Selected style must be Design.');
  if (state?.filters?.freeCancellation !== true) errors.push('Free cancellation filter must be selected.');
  if (state?.detail?.name !== 'Casa Flora') errors.push('Opened hotel must be Casa Flora.');
  if (state?.detail?.city !== 'Lisbon') errors.push('Opened hotel city must be Lisbon.');
  if (state?.detail?.style !== 'Design') errors.push('Opened hotel style must be Design.');
  if (state?.detail?.freeCancellation !== true) errors.push('Opened hotel must offer free cancellation.');
  return { passed: errors.length === 0, errors };
}
