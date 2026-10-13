export function findPublicLeaks(source) {
  const findings = [];
  for (const match of source.matchAll(/\bsk-[A-Za-z0-9_-]{20,}\b/g)) {
    if (!/^sk-(?:test|dummy|fixture)-/.test(match[0])) findings.push('Possible API credential');
  }
  if (/[A-Za-z]:[\\/]Users[\\/](?!Public[\\/])[^\s"'<>]+/.test(source)) findings.push('Personal absolute filesystem path');
  return findings;
}
