# Vendored code of the Proposals library

## jsdiff

`jsdiff-9.0.0.esm.min.js` is [jsdiff](https://github.com/kpdecker/jsdiff) 9.0.0, BSD-3-Clause (`jsdiff-LICENSE`), its ES module entry point bundled into one file and minified:

```sh
curl -sL https://registry.npmjs.org/diff/-/diff-9.0.0.tgz | tar xz
npx esbuild@0.25.0 package/libesm/index.js --bundle --format=esm --minify --legal-comments=none \
  --outfile=jsdiff-9.0.0.esm.min.js
```

The build (`npm run build:library`) carries it base64-encoded in the library page, which imports it from a `data:` URL: SilverBullet's Lua cannot hold the minified code in a long string, because some bracket sequences in it end the string early.

To update jsdiff: replace the `.js` file and the version in its name, here and in `scripts/build-library.ts`, then build.
