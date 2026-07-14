# Convenience targets. The canonical tooling is npm scripts (see package.json).
.PHONY: publish publish-dry

# Build + push the multi-arch gateway image to GHCR from this machine (no GitHub Actions).
# Pass flags through, e.g.: make publish ARGS="--yes"
publish:
	bash scripts/publish-image.sh $(ARGS)

# Build both arches without pushing (validation only).
publish-dry:
	bash scripts/publish-image.sh --dry-run
