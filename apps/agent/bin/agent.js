#!/usr/bin/env node
/*
  Minimal stateful Node agent for PTY integration.
  - Keeps simple in-memory context (recent messages)
  - Reads stdin lines; writes stdout lines
  - Safe by default: no shell exec
  - Commands:
    help        Show help
    remember X  Store a note
    recall      Show notes
    clear       Clear notes
    time        Show current time
    exit|quit   Exit process
  - Everything else: echoes with trivial, deterministic behavior
*/

import readline from "node:readline";
import process from "node:process";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

// In-memory state
const state = {
  notes: [], // stored via `remember`
  history: [], // last N user inputs
  maxHistory: 50,
};

function println(msg = "") {
  try {
    process.stdout.write(String(msg) + "\n");
  } catch {}
}

function prompt() {
  rl.setPrompt("› ");
  rl.prompt();
}

function handleLine(raw) {
  const line = String(raw || "").trim();
  if (!line) {
    prompt();
    return;
  }
  state.history.push(line);
  if (state.history.length > state.maxHistory) state.history.shift();

  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(" ");

  switch ((cmd || "").toLowerCase()) {
    case "help":
    case "?": {
      println("Commands:");
      println("- help           Show this help");
      println("- remember TEXT  Save a note");
      println("- recall         List saved notes");
      println("- clear          Clear saved notes");
      println("- time           Show current time");
      println("- exit|quit      Exit");
      break;
    }
    case "remember": {
      if (arg) {
        state.notes.push({ text: arg, ts: new Date().toISOString() });
        println("Saved.");
      } else {
        println("Usage: remember TEXT");
      }
      break;
    }
    case "recall": {
      if (state.notes.length === 0) {
        println("(no notes)");
      } else {
        state.notes.forEach((n, i) => {
          println(`${i + 1}. ${n.text} (${n.ts})`);
        });
      }
      break;
    }
    case "clear": {
      state.notes = [];
      println("Cleared.");
      break;
    }
    case "time": {
      println(new Date().toString());
      break;
    }
    case "exit":
    case "quit": {
      cleanupAndExit(0);
      return; // no prompt
    }
    default: {
      // Deterministic echo + tiny rules: lengths, words, last note ref
      const words = line.split(/\s+/).filter(Boolean);
      const lastNote = state.notes[state.notes.length - 1]?.text;
      println(`You said: "${line}"`);
      println(`- words: ${words.length}, chars: ${line.length}`);
      if (lastNote) println(`- last note: ${lastNote}`);
    }
  }
  prompt();
}

function cleanupAndExit(code = 0) {
  try {
    rl.close();
  } catch {}
  try {
    process.exitCode = code;
  } finally {
    process.exit();
  }
}

// Handle Ctrl-C (SIGINT) gracefully: print a line and re-prompt
process.on("SIGINT", () => {
  println("^C");
  prompt();
});

// Handle termination
process.on("SIGTERM", () => cleanupAndExit(0));
process.on("uncaughtException", (err) => {
  println(`[agent error] ${err?.message || String(err)}`);
  prompt();
});

println('Minimal VC Agent ready. Type "help" to see commands.');
prompt();

rl.on("line", handleLine);
rl.on("close", () => cleanupAndExit(0));
