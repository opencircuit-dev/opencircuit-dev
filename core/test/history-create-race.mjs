import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const mode = process.argv[2];
if (mode === "worker") {
	const [, , , dataDirectory, idempotencyKey, gatePath, readyPath] = process.argv;
	process.env.OCIRCUIT_GLOBAL_DIR = dataDirectory;
	fs.writeFileSync(readyPath, "ready", { mode: 0o600 });
	const waitArray = new Int32Array(new SharedArrayBuffer(4));
	while (!fs.existsSync(gatePath)) {
		Atomics.wait(waitArray, 0, 0, 10);
	}
	const { HistoryManager } = await import("../dist/util/history.js");
	const created = new HistoryManager().create({
		title: "Concurrent create validation",
		workspaceDirectory: "/test-workspace",
		idempotencyKey,
	});
	process.stdout.write(`${created.session.sessionId}\n`);
	process.exitCode = 0;
} else {
	const workerCount = 24;
	const roundCount = 4;
	const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocircuit-history-create-"));
	const workerFile = new URL(import.meta.url).pathname;

	function runWorker(dataDirectory, idempotencyKey, gatePath, readyPath) {
		return new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [workerFile, "worker", dataDirectory, idempotencyKey, gatePath, readyPath], {
				stdio: ["ignore", "pipe", "pipe"]
			});
			let stdout = "";
			let stderr = "";
			child.stdout.setEncoding("utf8").on("data", chunk => stdout += chunk);
			child.stderr.setEncoding("utf8").on("data", chunk => stderr += chunk);
			child.once("error", reject);
			child.once("close", code => {
				if (code !== 0) {
					reject(new Error(`Create worker exited with ${code}: ${stderr}`));
					return;
				}
				resolve(stdout.trim());
			});
		});
	}

	try {
		for (let round = 0; round < roundCount; round++) {
			const dataDirectory = path.join(temporaryRoot, `round-${round}`);
			fs.mkdirSync(dataDirectory, { mode: 0o700 });
			const sessionsDirectory = path.join(dataDirectory, "sessions");
			fs.mkdirSync(sessionsDirectory, { mode: 0o700 });
			const idempotencyKey = `same-key-round-${round}`;
			const keyDigest = createHash("sha256").update(idempotencyKey, "utf8").digest("hex");
			fs.writeFileSync(
				path.join(sessionsDirectory, `.history-create-${keyDigest}.lock`),
				JSON.stringify({
					host: os.hostname(),
					pid: 2_000_000_000,
					token: "stale-test-lock",
				}),
				{ mode: 0o600 },
			);
			const gatePath = path.join(dataDirectory, "start");
			const workers = Array.from({ length: workerCount }, (_, index) => {
				const readyPath = path.join(dataDirectory, `ready-${index}`);
				return {
					readyPath,
					result: runWorker(
						dataDirectory,
						idempotencyKey,
						gatePath,
						readyPath,
					),
				};
			});

			const deadline = Date.now() + 30_000;
			while (
				workers.some(worker => !fs.existsSync(worker.readyPath)) &&
				Date.now() < deadline
			) {
				await new Promise(resolve => setTimeout(resolve, 15));
			}
			assert.ok(
				workers.every(worker => fs.existsSync(worker.readyPath)),
				"All create workers should reach the start barrier",
			);
			fs.writeFileSync(gatePath, "go", { mode: 0o600 });

			const returnedSessionIds = await Promise.all(workers.map(worker => worker.result));
			assert.equal(new Set(returnedSessionIds).size, 1, "Same-key concurrent requests must return one session ID");
			const retryId = await runWorker(
				dataDirectory,
				idempotencyKey,
				gatePath,
				path.join(dataDirectory, "ready-retry"),
			);
			assert.equal(retryId, returnedSessionIds[0], "A new process must recover the original idempotent result");

			const sessionFiles = fs
				.readdirSync(sessionsDirectory)
				.filter(fileName => /^[0-9a-f-]{36}\.json$/i.test(fileName));
			assert.equal(sessionFiles.length, 1, "Same-key concurrent requests must persist one session");
			const sessionsList = JSON.parse(
				fs.readFileSync(path.join(sessionsDirectory, "sessions.json"), "utf8"),
			);
			assert.equal(sessionsList.length, 1, "Same-key concurrent requests must create one list entry");
			assert.equal(sessionsList[0].sessionId, returnedSessionIds[0]);
		}

		const distinctDirectory = path.join(temporaryRoot, "distinct-keys");
		fs.mkdirSync(distinctDirectory, { mode: 0o700 });
		const distinctSessionsDirectory = path.join(distinctDirectory, "sessions");
		fs.mkdirSync(distinctSessionsDirectory, { mode: 0o700 });
		const distinctGatePath = path.join(distinctDirectory, "start");
		const distinctWorkers = Array.from({ length: workerCount }, (_, index) => {
			const idempotencyKey = `distinct-key-${index}`;
			const keyDigest = createHash("sha256").update(idempotencyKey, "utf8").digest("hex");
			fs.writeFileSync(
				path.join(distinctSessionsDirectory, `.history-create-${keyDigest}.lock`),
				JSON.stringify({
					host: os.hostname(),
					pid: 2_000_000_000,
					token: `stale-test-lock-${index}`,
				}),
				{ mode: 0o600 },
			);
			const readyPath = path.join(distinctDirectory, `ready-${index}`);
			return {
				readyPath,
				result: runWorker(
					distinctDirectory,
					idempotencyKey,
					distinctGatePath,
					readyPath,
				),
			};
		});
		const distinctDeadline = Date.now() + 30_000;
		while (
			distinctWorkers.some(worker => !fs.existsSync(worker.readyPath)) &&
			Date.now() < distinctDeadline
		) {
			await new Promise(resolve => setTimeout(resolve, 15));
		}
		assert.ok(distinctWorkers.every(worker => fs.existsSync(worker.readyPath)));
		fs.writeFileSync(distinctGatePath, "go", { mode: 0o600 });
		const distinctSessionIds = await Promise.all(
			distinctWorkers.map(worker => worker.result),
		);
		assert.equal(new Set(distinctSessionIds).size, workerCount);
		const distinctFiles = fs
			.readdirSync(distinctSessionsDirectory)
			.filter(fileName => /^[0-9a-f-]{36}\.json$/i.test(fileName));
		assert.equal(distinctFiles.length, workerCount);
		const distinctSessionsList = JSON.parse(
			fs.readFileSync(path.join(distinctSessionsDirectory, "sessions.json"), "utf8"),
		);
		assert.equal(distinctSessionsList.length, workerCount);
		assert.deepEqual(
			new Set(distinctSessionsList.map(session => session.sessionId)),
			new Set(distinctSessionIds),
		);

		process.stdout.write(
			`Passed ${roundCount} same-key and one distinct-key concurrent-create round with ${workerCount} processes per round.\n`,
		);
	} finally {
		fs.rmSync(temporaryRoot, { recursive: true, force: true });
	}
}
