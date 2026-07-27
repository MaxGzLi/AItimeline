#!/usr/bin/env node
// Stub CLI standing in for a user-provided model command: it reads the prompt on
// stdin and prints a canned response file on stdout. `--fail` makes it exit non-zero
// so the smoke can check the failure path. Offline by design.
import { readFileSync } from "node:fs";

const [responseArg] = process.argv.slice(2);

let prompt = "";

for await (const chunk of process.stdin) {
  prompt += chunk;
}

if (!prompt.trim()) {
  process.stderr.write("fake-model-cli received an empty prompt on stdin\n");
  process.exit(2);
}

if (responseArg === "--fail") {
  process.stderr.write("fake-model-cli refused this prompt on purpose\n");
  process.exit(1);
}

process.stdout.write(readFileSync(responseArg, "utf8"));
