// node scripts/build-library.ts [--check]
//
// Builds the Proposals library (docs/proposals.md, section 5) from
// `library/src/` into the one page SilverBullet installs,
// `library/Proposals.md`: the frontmatter, the documentation, then the Lua
// fragments in one space-lua block, with jsdiff (library/vendor/) base64-encoded
// among them. The page carries the server's version and the number of the
// proposal format (src/proposal.ts), which the two must agree on.
//
// `--check` writes nothing and exits with 1 when the committed page is not
// what the sources build.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROPOSAL_FORMAT } from "../src/proposal.ts";

const ROOT = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** The Lua fragments, in the order they are concatenated: they share one scope. */
const LUA = ["proposals.lua", "diff.lua", "review.lua"];
const JSDIFF = "library/vendor/jsdiff-9.0.0.esm.min.js";

export const LIBRARY_PAGE = "Library/Finestream/Proposals";
export const LIBRARY_FILE = new URL("library/Proposals.md", ROOT);

const JSDIFF_HEAD = `
-----------------------------------------------------------------------
-- proposals.jsdiffSource
--
-- jsdiff 9.0.0 (https://github.com/kpdecker/jsdiff), BSD-3-Clause,
-- Copyright (c) 2009-2015, Kevin Decker; licence in
-- library/vendor/jsdiff-LICENSE of the repository. Its ES module
-- bundle, minified with esbuild, base64-encoded: SilverBullet's Lua
-- cannot hold the minified code in a long string. Imported from a
-- data: URL by proposals.jsdiff().
-----------------------------------------------------------------------
`;

export function buildLibrary(): string {
  const version = (JSON.parse(read("package.json")) as { version: string }).version;
  const stamp = (text: string) => text.replaceAll("@VERSION@", version).replaceAll("@FORMAT@", String(PROPOSAL_FORMAT));
  const jsdiff = `${JSDIFF_HEAD}proposals.jsdiffSource = "${readFileSync(new URL(JSDIFF, ROOT)).toString("base64")}"\n`;
  const lua = LUA.map((file) => read(`library/src/${file}`)).join("") + jsdiff;
  return stamp(read("library/src/frontmatter.md") + read("library/src/proposals.md")) + "\n```space-lua\n" + stamp(lua) + "```\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const page = buildLibrary();
  if (process.argv.includes("--check")) {
    if (readFileSync(LIBRARY_FILE, "utf8") !== page) {
      console.error("library/Proposals.md is not what library/src/ builds: run `npm run build:library` and commit the result.");
      process.exit(1);
    }
    console.log("library/Proposals.md is up to date");
  } else {
    writeFileSync(LIBRARY_FILE, page);
    console.log(`wrote library/Proposals.md (${page.length} characters)`);
  }
}
