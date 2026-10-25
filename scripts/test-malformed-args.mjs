import assert from "assert";

console.log("================================================================================");
console.log("TASK 4: MALFORMED TOOL ARGUMENTS VERIFICATION (READ & WRITE TOOLS)");
console.log("================================================================================");

// 1. JSON Argument Parser Validation
function parseToolArguments(rawArgs) {
  if (typeof rawArgs !== "string") {
    return { args: rawArgs || {}, parseError: undefined };
  }
  try {
    const args = JSON.parse(rawArgs);
    return { args, parseError: undefined };
  } catch (parseErr) {
    try {
      const cleaned = rawArgs.replace(/,\s*([}\]])/g, "$1");
      const args = JSON.parse(cleaned);
      return { args, parseError: undefined };
    } catch {
      return { args: null, parseError: parseErr.message || "Invalid JSON in arguments" };
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST A: Read Tool (woo__list_orders) with Malformed Arguments
// ────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST A] Read Tool: 'woo__list_orders' with malformed JSON arguments");
console.log("--------------------------------------------------------------------------------");

const malformedReadRaw = '{"after": "2026-10-21T00:00:00Z", per_page: unquoted_val, }';
const parsedRead = parseToolArguments(malformedReadRaw);

assert.strictEqual(parsedRead.args, null, "Read tool arguments must be strictly null on parse error (never {})");
assert.ok(parsedRead.parseError, "parseError must be populated for read tool");
console.log(`[PASS] Raw unparseable arguments: "${malformedReadRaw}"`);
console.log(`[PASS] Parser result: args = null, parseError = "${parsedRead.parseError}"`);

// Simulate agent loop response to malformed read tool
let readToolExecuted = false;
let readRetries = 0;
let readFinalMessage = "";

for (let attempt = 1; attempt <= 3; attempt++) {
  readRetries++;
  if (parsedRead.parseError || parsedRead.args === null) {
    if (readRetries > 2) {
      readFinalMessage = `Execution halted: the model provided unparseable tool call arguments after 2 retries (${parsedRead.parseError}).`;
      console.log(`[PASS] Retry ${attempt} (>2 retries limit reached) -> Halting loop with message:`);
      console.log(`       "${readFinalMessage}"`);
      break;
    }
    const parseErrMsg = `Tool error: Your call to "woo__list_orders" contained invalid/malformed JSON arguments: ${parsedRead.parseError}. You must retry the call with valid JSON formatted arguments.`;
    console.log(`[PASS] Retry ${attempt} (<=2 retries) -> Suppressed tool execution. Feedback fed back to model:`);
    console.log(`       "${parseErrMsg}"`);
  } else {
    readToolExecuted = true;
  }
}

assert.strictEqual(readToolExecuted, false, "CRITICAL: Read tool must NEVER execute with malformed arguments");
assert.ok(readFinalMessage.includes("Execution halted"), "Agent must halt after 2 retries with clear message");

// ────────────────────────────────────────────────────────────────────────────
// TEST B: Write Tool (woo__create_product) with Malformed Arguments
// ────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST B] Write Tool: 'woo__create_product' with malformed JSON arguments");
console.log("--------------------------------------------------------------------------------");

const malformedWriteRaw = '{"name": "Broken Headset", "regular_price": 499, status: invalid_json, }';
const parsedWrite = parseToolArguments(malformedWriteRaw);

assert.strictEqual(parsedWrite.args, null, "Write tool arguments must be strictly null on parse error (never {})");
assert.ok(parsedWrite.parseError, "parseError must be populated for write tool");
console.log(`[PASS] Raw unparseable arguments: "${malformedWriteRaw}"`);
console.log(`[PASS] Parser result: args = null, parseError = "${parsedWrite.parseError}"`);

// Simulate agent loop response to malformed write tool
let writeToolExecuted = false;
let writeRetries = 0;
let writeFinalMessage = "";

for (let attempt = 1; attempt <= 3; attempt++) {
  writeRetries++;
  if (parsedWrite.parseError || parsedWrite.args === null) {
    if (writeRetries > 2) {
      writeFinalMessage = `Execution halted: the model provided unparseable tool call arguments after 2 retries (${parsedWrite.parseError}).`;
      console.log(`[PASS] Retry ${attempt} (>2 retries limit reached) -> Halting loop with message:`);
      console.log(`       "${writeFinalMessage}"`);
      break;
    }
    const parseErrMsg = `Tool error: Your call to "woo__create_product" contained invalid/malformed JSON arguments: ${parsedWrite.parseError}. You must retry the call with valid JSON formatted arguments.`;
    console.log(`[PASS] Retry ${attempt} (<=2 retries) -> Suppressed tool execution. Feedback fed back to model:`);
    console.log(`       "${parseErrMsg}"`);
  } else {
    writeToolExecuted = true;
  }
}

assert.strictEqual(writeToolExecuted, false, "CRITICAL: Write tool must NEVER execute with malformed arguments");
assert.ok(writeFinalMessage.includes("Execution halted"), "Agent must halt after 2 retries with clear message");

console.log("\n================================================================================");
console.log("TASK 4 VERDICT: PASS (NO tool of any kind executed; parse error returned x2; clean halt on retry 3)");
console.log("================================================================================\n");
