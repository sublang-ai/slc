## Specs (Source of Truth)

- Canonical specs live in @specs/.
  Start with @specs/map.md for a quick-reference index and @specs/meta.md for the spec format; spec packages live in @specs/packages.
- Before making changes or suggestions in an area that has a spec, read the relevant spec file(s) first and follow them.
- Whenever your changes involve any spec, or you make a decision worth recording, keep the specs in sync — don't let them drift.
- Resolve conflicts spec-first, then iterate freely: an intended change that conflicts with existing spec items is resolved in the specs — or dropped — before coding against it; implementing first to explore an approach is fine, and implementation lessons update this intent's specs, but no intent completes until its specs and code agree.
- Keep specs lawful per @specs/meta.md — the law itself, not this summary: complete and exact (meta-34), minimal (meta-23), one requirement per item (meta-29), cohesive packages for a shared intent (meta-13), sections per meta-30, relationships and test evidence only as inline citations (meta-14, meta-16, meta-20), integration/system tests only (meta-21, meta-32).
- Use the globally installed `@sublang/spex@3.0.0` for `spex scaffold --update` migrations and `spex lint`.
  The repository-locked `@sublang/spex@0.3.0` remains the separately reviewed compiled-grammar semantic input under @specs/decisions/016-gears-grammar-provenance.md, not the spec-authoring tool.
- Run the 3.0.0 linter after editing specs to check structure, item IDs, and citations; never add trace lines to satisfy an older checker.
