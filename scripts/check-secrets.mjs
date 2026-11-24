#!/usr/bin/env node
// Public-repository guard: report only file names and rule names. Never echo a
// matched value to the terminal, which often feeds public CI logs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const rules = [
  ["GitHub token", /(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,})/g],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["AWS access key", /AKIA[0-9A-Z]{16}/g],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{20,}/g],
  [
    "literal credential assignment",
    /(?:api[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'`][^"'`\n]{16,}["'`]/gi,
  ],
];

const findings = [];
for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  for (const [name, pattern] of rules) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(`${file}: possible ${name}`);
  }
}

if (findings.length) {
  console.error(findings.join("\n"));
  console.error(`\nSecret scan failed: ${findings.length} possible secret(s). Values are redacted.`);
  process.exit(1);
}

console.log(`Secret scan passed (${files.length} tracked/untracked files).`);
