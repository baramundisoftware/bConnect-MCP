/**
 * Downloads the bConnect OpenAPI specifications of a bMS into openapi-specs/<release>/ (#335).
 *
 *   BCONNECT_BASE_URL=https://bms.example.com/bconnect BCONNECT_API_KEY=… \
 *     node scripts/download-openapi-specs.mjs <25R2|26R1>
 *
 * - Every module of the release: 25R2 has 10, 26R1 adds compliance and
 *   universal dynamic groups. Each file keeps the name it has in the repository.
 * - Credentials come from the environment, as for the servers: BCONNECT_API_KEY,
 *   or BCONNECT_USERNAME and BCONNECT_PASSWORD. They go into request headers,
 *   never onto a command line.
 * - The certificate is verified; BCONNECT_CA_CERT_PATH adds an internal CA.
 *   http:// is accepted only for this machine (a local mock).
 * - A file is replaced only by a complete download that is an OpenAPI document.
 *   Any failure is reported, and the script exits 1.
 *
 * Then regenerate the types: node scripts/generate-api-types.mjs
 *
 * No `#!` line: a test imports this module, and on a Windows checkout with CRLF
 * line endings that line ends in `\r`, which fails the import (SyntaxError).
 */
import http from "node:http";
import https from "node:https";
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The module (URL segment) and file name of each specification, per release. */
export const SPECS = {
  "25R2": {
    activedirectory: "bConnect_ActiveDirectory.json",
    assets: "bConnect_Assets.json",
    defensecontrol: "bConnect_DefenseControl.json",
    endpoints: "bConnect_Endpoints.json",
    jobs: "bConnect_Jobs.json",
    operatingsystems: "bConnect_OperatingSystems.json",
    servermanagement: "bConnect_ServerManagement.json",
    software: "bConnect_Software.json",
    updatemanagement: "bConnect_UpdateManagement.json",
    variables: "bConnect_Variables.json",
  },
  "26R1": {
    activedirectory: "bConnect_Activedirectory.json",
    assets: "bConnect_Assets.json",
    compliance: "bConnect_Compliance.json",
    defensecontrol: "bConnect_Defensecontrol.json",
    endpoints: "bConnect_Endpoints.json",
    jobs: "bConnect_Jobs.json",
    operatingsystems: "bConnect_Operatingsystems.json",
    servermanagement: "bConnect_Servermanagement.json",
    software: "bConnect_Software.json",
    universaldynamicgroups: "bConnect_Universaldynamicgroups.json",
    updatemanagement: "bConnect_Updatemanagement.json",
    variables: "bConnect_Variables.json",
  },
};

/** The URL of one specification on the bMS. */
export function specUrl(baseUrl, module, file) {
  // A scan, not a regex: linear on any input.
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === "/") {
    end--;
  }
  return `${baseUrl.slice(0, end)}/${module}/openAPI/v2.0/${file}`;
}

/** The request headers with the credential from `env`; throws when there is none. */
export function authHeaders(env) {
  if (env.BCONNECT_API_KEY) {
    return { "X-Api-Key": env.BCONNECT_API_KEY, Accept: "application/json" };
  }
  if (env.BCONNECT_USERNAME && env.BCONNECT_PASSWORD) {
    const basic = Buffer.from(`${env.BCONNECT_USERNAME}:${env.BCONNECT_PASSWORD}`, "latin1").toString("base64");
    return { Authorization: `Basic ${basic}`, Accept: "application/json" };
  }
  throw new Error("Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
}

/** The base URL; throws unless it is https, or http to this machine. */
export function checkBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new Error("BCONNECT_BASE_URL must be an https:// URL, for example https://bms.example.com/bconnect");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.startsWith("127.");
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) {
    return url.href;
  }
  throw new Error(`BCONNECT_BASE_URL must start with https:// (http:// only for this machine), got ${url.protocol}//`);
}

/** GET `url`; resolves with the body, rejects on a status other than 200 or a network or TLS error. */
export function get(url, headers, ca) {
  const client = url.startsWith("https:") ? https : http;
  return new Promise((resolve, reject) => {
    // Certificate checks stay on; `ca` adds an internal CA. Redirects aren't followed.
    const req = client.get(url, { headers, ...(ca && { ca }), timeout: 30000 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(Buffer.concat(chunks).toString("utf8"));
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timed out after 30 s")));
    req.on("error", reject);
  });
}

/** Downloads every specification of `release`; returns the failures (empty when all succeeded). */
export async function download(release, env, out = join(ROOT, "openapi-specs", release)) {
  const specs = SPECS[release];
  if (!specs) {
    throw new Error(`unknown release "${release}": use ${Object.keys(SPECS).join(" or ")}`);
  }
  const baseUrl = checkBaseUrl(env.BCONNECT_BASE_URL);
  const headers = authHeaders(env);
  const ca = env.BCONNECT_CA_CERT_PATH ? readFileSync(env.BCONNECT_CA_CERT_PATH, "utf8") : undefined;
  const failures = [];
  for (const [module, file] of Object.entries(specs)) {
    try {
      const body = await get(specUrl(baseUrl, module, file), headers, ca);
      const doc = JSON.parse(body);
      if (typeof doc.openapi !== "string" || typeof doc.paths !== "object") {
        throw new Error("not an OpenAPI document");
      }
      // Written next to the target, then moved over it: a failed download leaves the old file.
      const target = join(out, file);
      writeFileSync(`${target}.download`, body);
      renameSync(`${target}.download`, target);
      console.log(`✓ ${module} → openapi-specs/${release}/${file}`);
    } catch (error) {
      failures.push(`${module}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`✗ ${module}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

async function main() {
  const release = (process.argv[2] ?? "").toUpperCase();
  const failures = await download(release, process.env);
  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${Object.keys(SPECS[release]).length} specifications failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll specifications downloaded. Now run: node scripts/generate-api-types.mjs");
  }
}

// Run, unless a test imports it; a path through a symlink still counts as running it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`download-openapi-specs: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
