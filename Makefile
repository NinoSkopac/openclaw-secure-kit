.PHONY: lint test build e2e release-check

lint:
	npm run lint

test:
	npm test

build:
	npm run build

e2e:
	bash e2e/ubuntu.sh

release-check:
	npm ci
	npm run build
	npm test
	@if command -v shellcheck >/dev/null 2>&1; then \
		shellcheck install.sh uninstall.sh; \
	else \
		echo "WARNING: shellcheck not found; skipping shell script lint."; \
	fi
