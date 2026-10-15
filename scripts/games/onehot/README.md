# Onehot pattern tools

`public/games/onehot/patterns/boards.bin.gz` is the cached witness dataset. The builder selects records from witness archives and derives `pattern-costs.json`, `boards.bin.gz`, and `manifest.json`. It does not regenerate the cached boards from scratch or prove their gate counts globally minimal.

Rebuild the checked-in outputs into a fresh temporary directory and compare every file:

```sh
tmpdir="$(mktemp -d)"
pnpm onehot:build public/games/onehot/patterns/boards.bin.gz --output-dir "$tmpdir/generated"
cmp src/games/onehot/data/pattern-costs.json "$tmpdir/generated/pattern-costs.json"
cmp public/games/onehot/patterns/boards.bin.gz "$tmpdir/generated/boards.bin.gz"
cmp public/games/onehot/patterns/manifest.json "$tmpdir/generated/manifest.json"
pnpm onehot:check
```

`onehot:build` requires one or more witness archive paths and a new `--output-dir`. It fails if that directory already exists.
