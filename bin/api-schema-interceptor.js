#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const FRAMEWORK_LABELS = {
  next: "Next.js",
  react: "React",
  vue: "Vue",
  node: "Node",
  angular: "Angular",
};

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function detectFramework(pkg) {
  if (!pkg || typeof pkg !== "object") return null;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.next) return "next";
  if (deps.vue) return "vue";
  if (deps["@angular/core"]) return "angular";
  if (deps.react || deps["react-dom"]) return "react";
  return null;
}

function printHelp() {
  console.log("Usage:");
  console.log("  api-schema-interceptor init");
}

function createPrompt() {
  if (!process.stdin.isTTY) {
    const raw = fs.readFileSync(0, "utf8");
    const answers = raw.split(/\r?\n/);
    let idx = 0;
    return {
      ask(question) {
        process.stdout.write(question);
        const v = answers[idx] ?? "";
        idx += 1;
        return Promise.resolve(v.trim());
      },
      close() {},
    };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask(question) {
      return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
    },
    close() {
      rl.close();
    },
  };
}

function normalizeFramework(input) {
  const value = (input || "").toLowerCase();
  if (value === "1" || value === "next" || value === "next.js") return "next";
  if (value === "2" || value === "react") return "react";
  if (value === "3" || value === "vue") return "vue";
  if (value === "4" || value === "node" || value === "node.js") return "node";
  if (value === "angular") return "angular";
  return null;
}

function normalizeMode(input) {
  const value = (input || "").toLowerCase();
  if (!value) return "warn";
  if (value === "1" || value === "warn") return "warn";
  if (value === "2" || value === "observe") return "observe";
  if (value === "3" || value === "strict") return "strict";
  return null;
}

async function resolveFramework(prompt, detected) {
  if (detected) {
    console.log(`✓ Detected ${FRAMEWORK_LABELS[detected] || detected}`);
    return detected;
  }

  while (true) {
    console.log("? Framework: 1) Next.js  2) React  3) Vue  4) Node");
    const answer = await prompt.ask("> ");
    const framework = normalizeFramework(answer);
    if (framework) return framework;
    console.log("Please enter 1, 2, 3, 4, or a framework name.");
  }
}

async function resolveMode(prompt) {
  while (true) {
    console.log("? Mode: 1) warn  2) observe  3) strict (default: warn)");
    const answer = await prompt.ask("> ");
    const mode = normalizeMode(answer);
    if (mode) return mode;
    console.log("Please enter warn, observe, strict, or 1/2/3.");
  }
}

function selectConfigPath(cwd) {
  const candidates = ["lib/api-schemas.ts", "src/lib/api-schemas.ts"];
  for (const rel of candidates) {
    if (fs.existsSync(path.join(cwd, path.dirname(rel)))) return rel;
  }
  return "lib/api-schemas.ts";
}

function selectProviderPath(cwd) {
  const candidates = [
    "components/providers/InterceptorProvider.tsx",
    "src/components/providers/InterceptorProvider.tsx",
  ];
  for (const rel of candidates) {
    if (fs.existsSync(path.join(cwd, path.dirname(rel)))) return rel;
  }
  return "components/providers/InterceptorProvider.tsx";
}

function selectProviderIndexPath(cwd, providerPath) {
  const candidates = ["components/providers/index.ts", "src/components/providers/index.ts"];
  for (const rel of candidates) {
    if (fs.existsSync(path.join(cwd, rel))) return rel;
  }
  const parent = path.dirname(providerPath);
  return path.join(parent, "index.ts").replace(/\\/g, "/");
}

async function shouldOverwrite(prompt, relPath) {
  const answer = await prompt.ask(`? ${relPath} already exists. Overwrite? (y/N): `);
  return /^y(es)?$/i.test(answer);
}

function renderConfigFile(mode) {
  return [
    'import { createInterceptor } from "api-schema-interceptor";',
    'import { z } from "zod";',
    "",
    "export const interceptor = createInterceptor({",
    `  mode: "${mode}",`,
    "  warnOnUnmatched: true,",
    "  routes: {",
    "    // Example:",
    '    // "POST /login": {',
    "    //   request: z.object({ email: z.string().email(), password: z.string() }),",
    "    //   // optional: when false, don't validate and don't emit warnings/errors",
    "    //   validate: true,",
    "    //   response: z.object({ accessToken: z.string() }),",
    "    // },",
    "  },",
    "});",
    "",
  ].join("\n");
}

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

function providerImportPathFromProvider(configRelPath, providerRelPath) {
  const configDir = path.posix.dirname(toPosix(configRelPath));
  const providerDir = path.posix.dirname(toPosix(providerRelPath));
  let rel = path.posix.relative(providerDir, configDir);
  if (!rel || rel === ".") rel = ".";
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return `${rel}/api-schemas`;
}

function renderProviderFile(configRelPath, providerRelPath) {
  const importPath = providerImportPathFromProvider(configRelPath, providerRelPath);
  return [
    '"use client";',
    "",
    'import type { ReactNode } from "react";',
    'import { useEffect } from "react";',
    "",
    `import { interceptor } from "${importPath}";`,
    "",
    "type Props = {",
    "  children: ReactNode;",
    "};",
    "",
    "const InterceptorProvider = ({ children }: Props) => {",
    "  useEffect(() => {",
    "    interceptor.enable();",
    "    return () => interceptor.disable();",
    "  }, []);",
    "",
    "  return <>{children}</>;",
    "};",
    "",
    "export default InterceptorProvider;",
    "",
  ].join("\n");
}

function ensureDirFor(cwd, relPath) {
  fs.mkdirSync(path.join(cwd, path.dirname(relPath)), { recursive: true });
}

function ensureProviderIndexExport(cwd, indexRelPath) {
  const full = path.join(cwd, indexRelPath);
  if (!fs.existsSync(full)) {
    return { created: false, updated: false, exists: false };
  }
  const src = fs.readFileSync(full, "utf8");
  const exportLine = 'export { default as InterceptorProvider } from "./InterceptorProvider";';
  if (src.includes(exportLine)) return { created: false, updated: false, exists: true };

  const out = src.endsWith("\n") ? `${src}${exportLine}\n` : `${src}\n${exportLine}\n`;
  fs.writeFileSync(full, out, "utf8");
  return { created: false, updated: true, exists: true };
}

function printNextManualLayout(providerRelPath) {
  const normalized = toPosix(providerRelPath);
  const fromRoot = normalized.startsWith("src/")
    ? `@/${normalized.slice("src/".length).replace(/\.tsx$/, "")}`
    : `@/${normalized.replace(/\.tsx$/, "")}`;

  console.log("! layout wrapping is manual by design.");
  console.log("  Add this in your root layout (app/layout.tsx or src/app/layout.tsx):");
  console.log(`    import { InterceptorProvider } from "${fromRoot}";`);
  console.log("    // Wrap your provider tree:");
  console.log(
    `    // <InterceptorProvider><LayoutProvider>${"{children}"}</LayoutProvider></InterceptorProvider>`
  );
}

async function runInit() {
  const cwd = process.cwd();
  const appPkg = readJson(path.join(cwd, "package.json"));
  const prompt = createPrompt();

  try {
    const framework = await resolveFramework(prompt, detectFramework(appPkg));
    const mode = await resolveMode(prompt);
    console.log(`✓ Selected mode: ${mode}`);

    const configRelPath = selectConfigPath(cwd);
    const configFullPath = path.join(cwd, configRelPath);
    ensureDirFor(cwd, configRelPath);

    let writeConfig = true;
    if (fs.existsSync(configFullPath)) writeConfig = await shouldOverwrite(prompt, configRelPath);
    if (writeConfig) {
      fs.writeFileSync(configFullPath, renderConfigFile(mode), "utf8");
      console.log(`✓ Created ${toPosix(configRelPath)}`);
    } else {
      console.log(`! Kept existing ${toPosix(configRelPath)}`);
    }

    if (framework === "next") {
      const providerRelPath = selectProviderPath(cwd);
      const providerFullPath = path.join(cwd, providerRelPath);
      ensureDirFor(cwd, providerRelPath);

      let writeProvider = true;
      if (fs.existsSync(providerFullPath)) {
        writeProvider = await shouldOverwrite(prompt, providerRelPath);
      }
      if (writeProvider) {
        fs.writeFileSync(providerFullPath, renderProviderFile(configRelPath, providerRelPath), "utf8");
        console.log(`✓ Created ${toPosix(providerRelPath)}`);
      } else {
        console.log(`! Kept existing ${toPosix(providerRelPath)}`);
      }

      const indexRelPath = selectProviderIndexPath(cwd, providerRelPath);
      const indexResult = ensureProviderIndexExport(cwd, indexRelPath);
      if (indexResult.updated) {
        console.log(`✓ Updated ${toPosix(indexRelPath)} with InterceptorProvider export`);
      } else if (!indexResult.exists) {
        console.log(`! No provider index file found at ${toPosix(indexRelPath)}.`);
        console.log("  Add this export manually:");
        console.log('    export { default as InterceptorProvider } from "./InterceptorProvider";');
      } else {
        console.log(`✓ ${toPosix(indexRelPath)} already exports InterceptorProvider`);
      }

      printNextManualLayout(providerRelPath);
    } else {
      console.log(`! ${FRAMEWORK_LABELS[framework] || framework} auto-wiring is not enabled yet.`);
      console.log("  Add provider-style enable/disable at your app root:");
      console.log("    interceptor.enable();");
      console.log("    // on teardown: interceptor.disable();");
    }

    console.log("");
    console.log(`Open ${toPosix(configRelPath)} and add your routes. Done.`);
  } finally {
    prompt.close();
  }
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") return printHelp();
  if (command === "init") return runInit();
  console.log(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Failed to run api-schema-interceptor CLI.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

