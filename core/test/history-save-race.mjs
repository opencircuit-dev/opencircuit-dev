import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const mode = process.argv[2];
if (mode === "worker") {
	const [, , , dataDirectory, sessionId, clientId, gatePath, readyPath] = process.argv;
	process.env.OCIRCUIT_GLOBAL_DIR = dataDirectory;
	const { HistoryManager } = await import("../dist/util/history.js");
	const manager = new HistoryManager();
	const session = manager.load(sessionId);
	session.history.push({
		message: { role: "user", content: `concurrent-client:${clientId}` },
		contextItems: [],
	});
	fs.writeFileSync(readyPath, "ready", { mode: 0o600 });
	const waitArray = new Int32Array(new SharedArrayBuffer(4));
	while (!fs.existsSync(gatePath)) {
		Atomics.wait(waitArray, 0, 0, 10);
	}

	let conflictCount = 0;
	try {
		manager.save(session);
	} catch (error) {
		if (error?.code !== "HISTORY_SAVE_CONFLICT") {
			throw error;
		}
		conflictCount++;
		const latest = manager.load(sessionId);
		latest.history.push({
			message: { role: "user", content: `concurrent-client:${clientId}` },
			contextItems: [],
		});
		manager.save(latest);
	}
	process.stdout.write(`${JSON.stringify({ clientId, conflictCount })}\n`);
} else {
	const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocircuit-history-save-"));
	const dataDirectory = path.join(temporaryRoot, "data");
	fs.mkdirSync(dataDirectory, { mode: 0o700 });
	process.env.OCIRCUIT_GLOBAL_DIR = dataDirectory;
	const { HistoryManager } = await import("../dist/util/history.js");
	const manager = new HistoryManager();
	const created = manager.create({
		title: "Concurrent save validation",
		workspaceDirectory: "/test-workspace",
		idempotencyKey: "concurrent-save-validation",
	});
	const gatePath = path.join(dataDirectory, "start");
	const workerFile = new URL(import.meta.url).pathname;

	function runWorker(clientId, readyPath) {
		return new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [workerFile, "worker", dataDirectory, created.session.sessionId, clientId, gatePath, readyPath], {
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout.setEncoding("utf8").on("data", chunk => stdout += chunk);
			child.stderr.setEncoding("utf8").on("data", chunk => stderr += chunk);
			child.once("error", reject);
			child.once("close", code => {
				if (code !== 0) {
					reject(new Error(`Save worker exited with ${code}: ${stderr}`));
					return;
				}
				resolve(JSON.parse(stdout));
			});
		});
	}

	try {
		const workers = ["A", "B"].map(clientId => {
			const readyPath = path.join(dataDirectory, `ready-${clientId}`);
			return { readyPath, result: runWorker(clientId, readyPath) };
		});
		const deadline = Date.now() + 30_000;
		while (workers.some(worker => !fs.existsSync(worker.readyPath)) && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 15));
		}
		assert.ok(workers.every(worker => fs.existsSync(worker.readyPath)), "Both independent save clients should load the same starting revision");
		fs.writeFileSync(gatePath, "go", { mode: 0o600 });
		const outcomes = await Promise.all(workers.map(worker => worker.result));
		assert.equal(outcomes.reduce((sum, outcome) => sum + outcome.conflictCount, 0), 1, "One client must observe the stale revision and retry");

		const restored = manager.load(created.session.sessionId);
		const savedMessages = restored.history.map(item => item.message.content);
		assert.deepEqual(new Set(savedMessages), new Set(["concurrent-client:A", "concurrent-client:B"]));
		assert.equal(restored.history.length, 2, "Both concurrent updates must survive restore");
		assert.equal(restored.revision, 2);
		process.stdout.write("Passed: two independent processes saved the same session concurrently; stale revision was rejected, retried, and both transcript updates restored.\n");
	} finally {
		fs.rmSync(temporaryRoot, { recursive: true, force: true });
	}
}
