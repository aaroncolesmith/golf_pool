.PHONY: install run build start lint

install:
	npm install

run:
	rm -rf .next
	env -u NODE_OPTIONS npm run dev -- --port 3005

build:
	env -u NODE_OPTIONS npm run build

start:
	env -u NODE_OPTIONS npm run start -- --port 3005

lint:
	env -u NODE_OPTIONS npm run lint
