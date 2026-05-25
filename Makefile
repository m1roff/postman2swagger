IMAGE ?= miroff/postman2swagger
TAG ?= latest

build: ## Build Docker image for current platform
	docker build -t $(IMAGE):$(TAG) .

push: ## Push image to Docker Hub
	docker push $(IMAGE):$(TAG)

release: build push ## Build and push for current platform

build-multiplatform: ## Build and push for linux/amd64 and linux/arm64
	docker buildx build --platform linux/amd64,linux/arm64 -t $(IMAGE):$(TAG) --push .

.PHONY: build push release build-multiplatform