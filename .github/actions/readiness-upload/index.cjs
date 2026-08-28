#!/usr/bin/env node
/** Run the existing readiness package producer inside the GitHub Node action process. */

const { main } = require("../../../dist/maintainer/readiness-workflow.cjs");

void main(["package-upload"]).then((code) => {
  process.exitCode = code;
});
